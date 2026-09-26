import { describe, expect, it } from "vitest";
import { GenerationTasks } from "./generationTasks";

describe("generation task ownership", () => {
  it("reserves synchronously and retains canceled tasks until persistence finishes", () => {
    const tasks = new GenerationTasks();
    const a = tasks.begin("a")!;
    const b = tasks.begin("b")!;
    expect(tasks.begin("a")).toBeUndefined();
    tasks.stop("a");
    expect(a.controller.signal.aborted).toBe(true);
    expect(b.controller.signal.aborted).toBe(false);
    expect(tasks.begin("a")).toBeUndefined();
    tasks.finish(a);
    const next = tasks.begin("a")!;
    tasks.finish(a);
    expect(tasks.has("a")).toBe(true);
    expect(next.controller.signal.aborted).toBe(false);
    expect(tasks.getSnapshot()).toEqual(new Set(["b", "a"]));
  });

  it("aborts all on disposal and rejects stale sends without dropping save ownership", () => {
    const tasks = new GenerationTasks();
    const a = tasks.begin("a")!;
    const b = tasks.begin("b")!;
    tasks.dispose();
    expect(a.controller.signal.aborted).toBe(true);
    expect(b.controller.signal.aborted).toBe(true);
    expect(tasks.begin("c")).toBeUndefined();
    expect(tasks.getSnapshot()).toEqual(new Set(["a", "b"]));
    tasks.activate();
    expect(tasks.begin("a")).toBeUndefined();
    tasks.finish(a);
    expect(tasks.begin("a")).toBeDefined();
  });
});
