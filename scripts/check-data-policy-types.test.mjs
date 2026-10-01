import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const insertedField = "newlyPersistedField";

function walk(node, callback) {
  callback(node);
  ts.forEachChild(node, child => walk(child, callback));
}

function config() {
  const file = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  assert.equal(file.error, undefined, "Repository tsconfig must be readable.");
  const parsed = ts.parseJsonConfigFileContent(file.config, ts.sys, root);
  assert.equal(parsed.errors.length, 0, "Repository tsconfig must parse without errors.");
  return parsed;
}

function errors(program) {
  return ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
}

function diagnosticLocations(diagnostics) {
  // Report paths/codes only, never diagnostic source text or configuration values.
  return diagnostics.map(diagnostic => {
    const file = diagnostic.file;
    const location = file && file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return `${file ? path.relative(root, file.fileName) : "tsconfig"}:${location ? location.line + 1 : 0} TS${diagnostic.code}`;
  }).join("\n");
}

function insertOptionalFields(source, typeNodes) {
  const positions = typeNodes.map(node => {
    assert.ok(ts.isTypeLiteralNode(node) || ts.isInterfaceDeclaration(node), "Mutation target must be a real persisted object type.");
    const position = ts.isInterfaceDeclaration(node)
      ? source.text.indexOf("{", node.name.end) + 1 : node.getStart(source) + 1;
    assert.ok(position > 0 && position < node.end, "Mutation target must have an object body.");
    return position;
  }).sort((a, b) => b - a);
  let text = source.text;
  for (const position of positions) text = `${text.slice(0, position)} ${insertedField}?: string; ${text.slice(position)}`;
  return text;
}

function source(program, relative) {
  const result = program.getSourceFile(path.join(root, relative));
  assert.ok(result, `Repository source must exist: ${relative}`);
  return result;
}

test("new actual persisted row and nested fields require an explicit FieldPolicy", () => {
  const parsed = config();
  const baseline = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options,
    projectReferences: parsed.projectReferences });
  const baselineErrors = errors(baseline);
  assert.equal(baselineErrors.length, 0, `Baseline must compile before policy mutations:\n${diagnosticLocations(baselineErrors)}`);

  const overrides = new Map();
  const database = source(baseline, "src/storage/database.ts");
  const rowTypes = new Map();
  walk(database, node => {
    if (!ts.isPropertyDeclaration(node) || !ts.isIdentifier(node.name)
      || !["userAvatar", "legacyConversationConfigs"].includes(node.name.text)) return;
    assert.ok(node.type && ts.isTypeReferenceNode(node.type), "Database row must have an explicit table type.");
    const row = node.type.typeArguments?.[0];
    assert.ok(row && ts.isTypeLiteralNode(row), "Mutate the actual EntityTable row, not a duplicate policy helper.");
    rowTypes.set(node.name.text, row);
  });
  assert.deepEqual([...rowTypes.keys()].sort(), ["legacyConversationConfigs", "userAvatar"]);
  overrides.set(database.fileName, insertOptionalFields(database, [...rowTypes.values()]));

  for (const [relative, name] of [
    ["src/chat/sessionConfig.ts", "SessionConfig"],
    ["src/chat/conversationConfig.ts", "ConversationConfig"],
  ]) {
    const file = source(baseline, relative);
    const declaration = file.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === name);
    assert.ok(declaration, `Mutation must use the actual ${name} declaration.`);
    overrides.set(file.fileName, insertOptionalFields(file, [declaration]));
  }

  const avatar = source(baseline, "src/avatar/repository.ts");
  const userAvatar = avatar.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === "UserAvatar");
  assert.ok(userAvatar, "UserAvatar must remain a declared persisted type.");
  const avatarSource = userAvatar.members.find(node => ts.isPropertySignature(node)
    && ts.isIdentifier(node.name) && node.name.text === "source");
  assert.ok(avatarSource?.type && ts.isTypeLiteralNode(avatarSource.type), "Mutation must use the nested avatar provenance type.");
  overrides.set(avatar.fileName, insertOptionalFields(avatar, [avatarSource.type]));

  const host = ts.createCompilerHost(parsed.options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const mutatedSources = new Map();
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    // Both programs share an immutable baseline snapshot. Overrides live only in this host.
    const original = baseline.getSourceFile(fileName);
    if (overrides.has(fileName) || original) {
      if (!mutatedSources.has(fileName)) mutatedSources.set(fileName,
        ts.createSourceFile(fileName, overrides.get(fileName) ?? original.text, languageVersion, true));
      return mutatedSources.get(fileName);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const mutated = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options,
    projectReferences: parsed.projectReferences, host });
  assert.equal(source(mutated, "src/storage/database.ts").text.split(`${insertedField}?: string`).length - 1, 2,
    "Both actual database row declarations must be mutated in memory.");
  const mutationErrors = errors(mutated);
  const policyFile = source(mutated, "src/storage/dataPolicies.ts");
  const matchingErrors = mutationErrors.filter(diagnostic => diagnostic.file?.fileName === policyFile.fileName
    && diagnostic.code === 1360 // A `satisfies` clause rejected the omitted policy member.
    && ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").includes(insertedField));
  const policies = new Map();
  walk(policyFile, node => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) policies.set(node.name.text, node);
  });
  assert.ok(matchingErrors.length >= 5, `Expected at least five exhaustive policy failures; got ${matchingErrors.length}.\n${diagnosticLocations(mutationErrors)}`);
  for (const name of ["userAvatar", "legacyConversationConfigs", "session", "conversationConfig", "avatarSource"]) {
    const policy = policies.get(name);
    assert.ok(policy, `Explicit policy must exist: ${name}`);
    assert.ok(matchingErrors.some(diagnostic => diagnostic.start >= policy.getStart(policyFile)
      && diagnostic.start < policy.end), `Adding an optional persisted field must fail the ${name} policy.`);
  }
  // Optional fields preserve existing object construction; every compiler failure must be a policy omission.
  assert.equal(mutationErrors.length, matchingErrors.length,
    `Mutation produced an unrelated compiler error:\n${diagnosticLocations(mutationErrors.filter(error => !matchingErrors.includes(error)))}`);
});
