import { describe, expect, it } from "vitest";
import { agentChoice, type ModelChoice } from "../src/model/models";
import { codexDefault, codexModels, standIn } from "./models";
import { agentCommand } from "./runner";

describe("codexModels", () => {
  it("lists the models Codex shows, in its order, with their thinking levels", () => {
    const models = codexModels(
      JSON.stringify({
        models: [
          { slug: "gpt-old", display_name: "GPT-Old", description: "Older fast model.", visibility: "list", priority: 9, supported_reasoning_levels: [{ effort: "low" }] },
          { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide", priority: 0 },
          {
            slug: "gpt-new",
            display_name: "GPT-New",
            description: "Latest workhorse.",
            visibility: "list",
            priority: 1,
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }, { effort: "sideways" }],
          },
          { slug: "--yolo", display_name: "Flag", visibility: "list", priority: 2 },
        ],
      }),
    );
    expect(models).toEqual([
      { id: "gpt-new", name: "GPT-New", hint: "Latest workhorse.", efforts: ["low", "ultra"], defaultEffort: "medium" },
      { id: "gpt-old", name: "GPT-Old", hint: "Older fast model.", efforts: ["low"], older: true },
    ]);
  });

  it("lists nothing when the cache is missing or broken", () => {
    expect(codexModels("")).toEqual([]);
    expect(codexModels('{"models": 3}')).toEqual([]);
  });
});

describe("codexDefault", () => {
  it("reads the model and thinking at the top of config.toml, not inside a section", () => {
    const toml = ['model = "example-codex-previous"', "model_reasoning_effort = 'high'", "", "[profiles.fast]", 'model = "example-codex-fast"'].join("\n");
    expect(codexDefault(toml)).toEqual({ model: "example-codex-previous", effort: "high" });
    expect(codexDefault('[profiles.fast]\nmodel = "example-codex-fast"')).toEqual({ model: null, effort: null });
  });
});

describe("standIn", () => {
  const models: ModelChoice[] = [
    { id: "gpt-old", name: "GPT-Old", hint: "Older.", efforts: ["low"], older: true },
    { id: "example-codex-current", name: "Example Codex Current", hint: "", efforts: ["low", "medium", "high"], defaultEffort: "medium" },
  ];

  it("keeps a default Codex still offers, or one Shepherd cannot check", () => {
    expect(standIn({ model: "example-codex-current", effort: "high" }, models)).toEqual({ model: "example-codex-current", effort: "high" });
    expect(standIn({ model: null, effort: "high" }, models)).toEqual({ model: null, effort: "high" });
    expect(standIn({ model: "example-codex-previous", effort: "high" }, [])).toEqual({ model: "example-codex-previous", effort: "high" });
  });

  it("puts the first current model in place of one Codex stopped offering, and keeps its thinking when it can", () => {
    expect(standIn({ model: "example-codex-previous", effort: "high" }, models)).toEqual({ model: "example-codex-current", effort: "high", unavailable: "example-codex-previous" });
    expect(standIn({ model: "example-codex-previous", effort: "ultra" }, models)).toEqual({ model: "example-codex-current", effort: "medium", unavailable: "example-codex-previous" });
  });
});

describe("agentChoice", () => {
  it("names the stand-in only for steps on the default", () => {
    const own = { model: "example-codex-current", effort: "high" as const, unavailable: "example-codex-previous" };
    expect(agentChoice({}, own)).toEqual({ model: "example-codex-current", effort: "high" });
    expect(agentChoice({ effort: "low" }, own)).toEqual({ model: "example-codex-current", effort: "low" });
    expect(agentChoice({ model: "example-codex-fast" }, own)).toEqual({ model: "example-codex-fast" });
    expect(agentChoice({}, { model: "example-codex-current", effort: "high" })).toEqual({});
  });
});

describe("agentCommand", () => {
  it("leaves Codex on its own default unless the step picked a model or thinking", () => {
    const plain = agentCommand("codex", "Do it", null).args;
    expect(plain).not.toContain("-m");
    expect(plain.join(" ")).not.toContain("model_reasoning_effort");

    const picked = agentCommand("codex", "Do it", "session-1", { model: "example-codex-current", effort: "max" }).args;
    expect(picked.slice(0, 3)).toEqual(["exec", "resume", "session-1"]);
    expect(picked).toEqual(expect.arrayContaining(["-m", "example-codex-current", "-c", 'model_reasoning_effort="max"']));
    expect(picked.at(-1)).toBe("Do it");
  });

  it("gives Claude Code its model and effort", () => {
    const { cmd, args } = agentCommand("claude", "Do it", "session-2", { model: "opus", effort: "xhigh" });
    expect(cmd).toBe("claude");
    expect(args).toEqual(expect.arrayContaining(["--model", "opus", "--effort", "xhigh", "--resume", "session-2"]));
    expect(agentCommand("claude", "Do it", null).args).not.toContain("--model");
  });

  it("never passes a model that could be read as a flag", () => {
    const args = agentCommand("codex", "Do it", null, { model: "--dangerously-bypass-approvals-and-sandbox" }).args;
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("-m");
  });
});
