import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const databasePath = "src/storage/database.ts";
const registryPath = "src/storage/dataRegistry.ts";
const backupPath = "src/backup/types.ts";
const preferencePrefix = "ayase-studio.";
const storageMethods = new Set(["getItem", "setItem", "removeItem"]);
const sourceFilePattern = /\.[cm]?[jt]sx?$/;
const testFilePattern = /(?:^|\/)(?:__tests__|test|tests)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/;

function unwrap(node) {
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, child => visit(child, callback));
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression)) return node.expression.text;
  return undefined;
}

/** Inspect source text only; never load application code or persistent data. */
export function inspectDataContracts(sources) {
  const errors = [];
  const files = new Map(Object.entries(sources)
    .map(([name, text]) => [path.posix.resolve("/", name.replaceAll("\\", "/")), text])
    .filter(([name]) => sourceFilePattern.test(name) && !testFilePattern.test(name)));
  const options = { noLib: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve };
  const host = {
    getSourceFile: name => files.has(name) ? ts.createSourceFile(name, files.get(name), options.target, true) : undefined,
    getDefaultLibFileName: () => "", writeFile: () => {}, getCurrentDirectory: () => "/",
    getDirectories: () => [], fileExists: name => files.has(name), readFile: name => files.get(name),
    useCaseSensitiveFileNames: () => true, getCanonicalFileName: name => name, getNewLine: () => "\n",
  };
  const program = ts.createProgram([...files.keys()], options, host);
  const checker = program.getTypeChecker();
  const sourceFiles = program.getSourceFiles();
  for (const source of sourceFiles) {
    if (source.parseDiagnostics.length) errors.push(`Cannot parse ${source.fileName.slice(1)}.`);
  }
  const sourceAt = name => program.getSourceFile(`/${name}`);
  for (const name of [databasePath, registryPath, backupPath]) {
    if (!sourceAt(name)) errors.push(`Missing contract source: ${name}.`);
  }
  function declaration(name, file, required = true) {
    let result;
    if (file) visit(file, node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
        result = unwrap(node.initializer);
      }
    });
    if (!result && required) errors.push(`Missing static declaration: ${name}.`);
    return result;
  }
  function staticObject(name) {
    const node = declaration(name, sourceAt(registryPath));
    const entries = new Map();
    if (!node || !ts.isObjectLiteralExpression(node)) {
      errors.push(`${name} must be a static object literal.`);
      return entries;
    }
    for (const property of node.properties) {
      const key = property.name && propertyName(property.name);
      if (!ts.isPropertyAssignment(property) || key === undefined) {
        errors.push(`${name} contains a non-static entry.`);
        continue;
      }
      if (entries.has(key)) errors.push(`${name} contains a duplicate entry: ${key}.`);
      entries.set(key, unwrap(property.initializer));
    }
    return entries;
  }
  const tableRegistry = staticObject("persistentTables");
  const preferenceRegistry = staticObject("persistentPreferences");
  const tableNames = new Set();
  const database = sourceAt(databasePath);
  if (database) visit(database, node => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)
      || node.expression.name.text !== "stores") return;
    const schema = unwrap(node.arguments[0]);
    if (!schema || !ts.isObjectLiteralExpression(schema)) {
      errors.push("Database stores schema must be a static object literal.");
      return;
    }
    for (const property of schema.properties) {
      const key = property.name && propertyName(property.name);
      if (!ts.isPropertyAssignment(property) || key === undefined) {
        errors.push("Database stores schema contains a non-static table.");
        continue;
      }
      // Dexie null schemas drop an earlier table; later schemas may reintroduce it.
      if (unwrap(property.initializer).kind === ts.SyntaxKind.NullKeyword) tableNames.delete(key);
      else tableNames.add(key);
    }
  });
  function compare(actual, registered, label) {
    for (const key of [...actual].sort()) {
      if (!registered.has(key)) errors.push(`Unregistered ${label}: ${key}.`);
    }
    for (const key of [...registered].sort()) {
      if (!actual.has(key)) errors.push(`Stale ${label} registration: ${key}.`);
    }
  }
  compare(tableNames, new Set(tableRegistry.keys()), "table");

  // Trace storage key arguments through local/imported constants and helper parameters.
  // Prefix-shaped strings in format markers, library IDs and stored values are not keys.
  const parameterInputs = new Map();
  function addInput(parameter, expression) {
    if (!ts.isIdentifier(parameter.name)) return;
    const symbol = checker.getSymbolAtLocation(parameter.name);
    if (!symbol) return;
    const inputs = parameterInputs.get(symbol) ?? [];
    inputs.push(expression);
    parameterInputs.set(symbol, inputs);
  }
  for (const source of sourceFiles) visit(source, node => {
    if (!ts.isCallExpression(node)) return;
    const signature = checker.getResolvedSignature(node);
    signature?.declaration?.parameters.forEach((parameter, index) => {
      if (node.arguments[index]) addInput(parameter, node.arguments[index]);
    });
    if (ts.isPropertyAccessExpression(node.expression)
      && ["map", "forEach", "filter", "some", "every", "find"].includes(node.expression.name.text)) {
      const callback = unwrap(node.arguments[0]);
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters[0]) {
        addInput(callback.parameters[0], node.expression.expression);
      }
    }
  });
  function objectKeys(expression, seen) {
    const node = unwrap(expression);
    if (!node || seen.has(node)) return [];
    seen = new Set(seen).add(node);
    if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap(property => {
      if (ts.isSpreadAssignment(property)) return objectKeys(property.expression, seen);
      const key = property.name && propertyName(property.name);
      return key === undefined ? [] : [key];
    });
    let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return (symbol?.declarations ?? []).flatMap(declared =>
      declared.initializer ? objectKeys(declared.initializer, seen) : []);
  }
  function strings(expression, seen = new Set()) {
    const node = unwrap(expression);
    if (!node || seen.has(node)) return [];
    seen = new Set(seen).add(node);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Object"
      && node.expression.name.text === "keys" && node.arguments[0]) {
      return objectKeys(node.arguments[0], seen);
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(element =>
      strings(ts.isSpreadElement(element) ? element.expression : element, seen));
    if (ts.isConditionalExpression(node)) return [...strings(node.whenTrue, seen), ...strings(node.whenFalse, seen)];
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
      return [...strings(node.left, seen), ...strings(node.right, seen)];
    }
    const location = ts.isPropertyAccessExpression(node) ? node.name : node;
    let symbol = checker.getSymbolAtLocation(location);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    if (!symbol) return [];
    const result = (parameterInputs.get(symbol) ?? []).flatMap(input => strings(input, seen));
    for (const declared of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declared) || ts.isPropertyAssignment(declared)
        || ts.isParameter(declared)) {
        if (declared.initializer) result.push(...strings(declared.initializer, seen));
        if (ts.isVariableDeclaration(declared) && ts.isVariableDeclarationList(declared.parent)
          && ts.isForOfStatement(declared.parent.parent)) {
          result.push(...strings(declared.parent.parent.expression, seen));
        }
      }
    }
    return result;
  }
  const preferenceKeys = new Set();
  for (const source of sourceFiles) visit(source, node => {
    if (!ts.isCallExpression(node) || !node.arguments[0]) return;
    const expression = unwrap(node.expression);
    const method = ts.isPropertyAccessExpression(expression) ? expression.name.text
      : ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)
        ? expression.argumentExpression.text : undefined;
    if (!storageMethods.has(method)) return;
    for (const key of strings(node.arguments[0])) {
      if (key.startsWith(preferencePrefix)) preferenceKeys.add(key);
    }
  });
  compare(preferenceKeys, new Set(preferenceRegistry.keys()), "preference key");

  const backedUp = new Set();
  const backupDeclaration = declaration("backupTables", sourceAt(backupPath));
  if (!backupDeclaration || !ts.isArrayLiteralExpression(backupDeclaration)) {
    errors.push("backupTables must be a static array literal.");
  } else for (const element of backupDeclaration.elements) {
    if (!ts.isStringLiteralLike(element)) {
      errors.push("backupTables contains a non-static table.");
      continue;
    }
    if (backedUp.has(element.text)) errors.push(`backupTables contains a duplicate table: ${element.text}.`);
    backedUp.add(element.text);
  }
  const included = new Set(), projected = new Set();
  const projectedDeclaration = declaration("projectedBackupTables", sourceAt(backupPath), false);
  const projectedTables = new Set();
  if (projectedDeclaration) {
    if (!ts.isArrayLiteralExpression(projectedDeclaration)) errors.push("projectedBackupTables must be a static array literal.");
    else for (const entry of projectedDeclaration.elements) {
      if (!ts.isStringLiteralLike(entry) || projectedTables.has(entry.text)) errors.push("Invalid projected backup table.");
      else projectedTables.add(entry.text);
    }
  }
  for (const [name, entry] of tableRegistry) {
    if (!ts.isObjectLiteralExpression(entry)) {
      errors.push(`Table registration must have a static backup policy: ${name}.`);
      continue;
    }
    const policy = entry.properties.find(property => property.name && propertyName(property.name) === "backup");
    const value = policy && ts.isPropertyAssignment(policy) && unwrap(policy.initializer);
    if (!value || !ts.isStringLiteralLike(value) || !["included", "excluded", "pending-93", "projected"].includes(value.text)) {
      errors.push(`Table registration must have a static backup policy: ${name}.`);
    } else if (value.text === "included") included.add(name);
    else if (value.text === "projected") projected.add(name);
  }
  compare(backedUp, included, "backup table");
  compare(projectedTables, projected, "projected backup table");
  for (const table of projectedTables) if (backedUp.has(table)) errors.push(`Projected table must not be exported as raw rows: ${table}.`);
  return { errors: [...new Set(errors)].sort(), tables: [...tableNames].sort(),
    preferences: [...preferenceKeys].sort(), backupTables: [...backedUp].sort() };
}

export function checkDataContracts(sources) {
  return inspectDataContracts(sources).errors;
}

function readSources(root) {
  const sources = {};
  function readDirectory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) readDirectory(fullPath);
      else if (entry.isFile() && sourceFilePattern.test(entry.name)) {
        const relative = path.relative(root, fullPath).replaceAll("\\", "/");
        if (!testFilePattern.test(relative)) sources[relative] = fs.readFileSync(fullPath, "utf8");
      }
    }
  }
  readDirectory(path.join(root, "src"));
  return sources;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const result = inspectDataContracts(readSources(root));
    if (result.errors.length) {
      console.error(result.errors.join("\n"));
      process.exitCode = 1;
    } else console.log(`Data contracts covered: ${result.tables.length} tables, ${result.preferences.length} preference keys, ${result.backupTables.length} backup tables.`);
  } catch {
    // Do not echo exception text or source values: persistence may contain credentials.
    console.error("Data contract inspection failed; check the contract sources and checker tests.");
    process.exitCode = 1;
  }
}
