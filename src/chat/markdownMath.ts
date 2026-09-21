import type { Root, RootContent } from "mdast";
import type { Construct, State, Tokenizer } from "micromark-util-types";
import type { Plugin } from "unified";
import type {} from "remark-parse";
import type {} from "micromark-extension-math";

const whitespace = (code: number | null) => code !== null && (code < 0 || code === 32);

// Use remark-math's nodes, but recognize delimiters before Markdown consumes
// backslash escapes. Token positions stay anchored to the untouched source.
const tokenizeMath: Tokenizer = function (effects, ok, nok) {
  const context = this;
  let dollar = false;
  let size = 0;
  let closing = 0;
  let hasContent = false;
  let previous: number | null = null;
  let remaining = 0;
  let dataOpen = false;

  const start: State = (code) => {
    // Only dollar runs need this guard; bracket math may follow dollar math.
    if (code === 36 && context.previous === 36 && context.events[context.events.length - 1]?.[1].type !== "characterEscape") return nok(code);
    dollar = code === 36;
    effects.enter("mathText");
    effects.enter("mathTextSequence");
    effects.consume(code!);
    size = 1;
    return opener;
  };
  const opener: State = (code) => {
    if (dollar && code === 36 && size === 1) {
      effects.consume(code); size = 2; return begin;
    }
    if (!dollar) {
      if (code !== 40 && code !== 91) return nok(code);
      closing = code === 40 ? 41 : 93;
      effects.consume(code); size = 2; return begin;
    }
    return begin(code);
  };
  const begin: State = (code) => {
    if (code === null || (dollar && (code === 36 || (size === 1 && whitespace(code))))) return nok(code);
    effects.exit("mathTextSequence");
    return data(code);
  };
  const closeCheck: Construct = { tokenize(checkEffects, checkOk, checkNok) {
    let count = 0;
    const check: State = (code) => {
      const expected = dollar ? 36 : count === 0 ? 92 : closing;
      if (code !== expected) return checkNok(code);
      checkEffects.consume(code); count++;
      return count === size ? after : check;
    };
    const after: State = (code) => {
      if (dollar && (code === 36 || (size === 1 && code !== null && code >= 48 && code <= 57))) return checkNok(code);
      checkEffects.exit("mathTextSequence");
      return checkOk(code);
    };
    checkEffects.enter("mathTextSequence");
    return check;
  } };
  const close: State = (code) => {
    if (dataOpen) effects.exit("mathTextData");
    effects.enter("mathTextSequence");
    remaining = size;
    return finish(code);
  };
  const finish: State = (code) => {
    effects.consume(code!);
    if (--remaining) return finish;
    effects.exit("mathTextSequence");
    effects.exit("mathText");
    return ok;
  };
  const escaped: State = (code) => {
    if (code === null) return nok(code);
    if (code === -5 || code === -4 || code === -3) return data(code);
    effects.consume(code); previous = code; hasContent = true;
    return data;
  };
  const consume: State = (code) => {
    if (!dataOpen) { effects.enter("mathTextData"); dataOpen = true; }
    effects.consume(code!); previous = code; hasContent = true;
    return code === 92 ? escaped : data;
  };
  const data: State = (code) => {
    if (code === null) return nok(code);
    if (code === -5 || code === -4 || code === -3) {
      if (dataOpen) { effects.exit("mathTextData"); dataOpen = false; }
      effects.enter("lineEnding"); effects.consume(code); effects.exit("lineEnding");
      previous = code;
      return data;
    }
    if (dollar && code === 96) return nok(code);
    if (dollar && code === 36) {
      // Pandoc-style single-dollar boundaries avoid "$10 and $20". Reject
      // this candidate instead of swallowing a later, unrelated formula.
      if (!hasContent || (size === 1 && whitespace(previous))) return nok(code);
      return effects.check(closeCheck, close, nok)(code);
    }
    if (!dollar && code === 92 && hasContent) return effects.check(closeCheck, close, consume)(code);
    return consume(code);
  };
  return start;
};

// Display blocks own their lines, so a leading minus in an aligned equation
// cannot become a Markdown list. Inline forms still use the text construct.
const displayMath: Construct = { name: "ayaseMathDisplay", concrete: true, tokenize(effects, ok, nok) {
  const context = this;
  const opening: Construct = { tokenize(checkEffects, checkOk, checkNok) {
    let second = 0;
    const start: State = (code) => {
      second = code === 36 ? 36 : 91;
      checkEffects.enter("mathTextSequence"); checkEffects.consume(code!);
      return next;
    };
    const next: State = (code) => {
      if (code !== second) return checkNok(code);
      checkEffects.consume(code); checkEffects.exit("mathTextSequence");
      return checkOk;
    };
    return start;
  } };
  return effects.check(opening, (code) => tokenizeMath.call(context, effects,
    (end) => end === null || end === -5 || end === -4 || end === -3 ? ok(end) : nok(end), nok)(code), nok);
} };

export const remarkMathSyntax: Plugin<[], Root> = function () {
  const data = this.data();
  const syntax: Construct = { name: "ayaseMathText", tokenize: tokenizeMath };
  (data.micromarkExtensions ??= []).push({
    // Both forms must wait for a closing delimiter. The stock flow parser
    // accepts an unfinished $$ opener and treats its first line as metadata.
    disable: { null: ["mathText", "mathFlow"] },
    flow: { 36: displayMath, 92: displayMath },
    text: { 36: syntax, 92: syntax },
  });

  return (tree, file) => {
    const source = String(file);
    const visit = (node: Root | RootContent) => {
      if (node.type === "code" && node.lang === "math") {
        // Even explicitly math-labelled fenced code remains source code.
        node.data = { ...node.data, hProperties: { className: ["language-tex"] } };
      }
      if (node.type === "inlineMath") {
        const raw = source.slice(node.position!.start.offset, node.position!.end.offset);
        if (raw.startsWith("\\[") || raw.startsWith("$$")) {
          node.data!.hProperties = { className: ["math-display"] };
        }
      }
      if ("children" in node) node.children.forEach(visit);
    };
    visit(tree);
  };
};
