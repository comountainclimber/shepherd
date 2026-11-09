import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reducer } from "../src/model/reducer";
import { workspace } from "../src/model/workspace";
import { linkedRepos, repoPath } from "./projectRepos";
import { checkFolder, projectFolder } from "./runner";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("repository project folders", () => {
  it("expands ~ and rejects paths relative to the server", () => {
    expect(repoPath("~/projects/my app")).toBe(path.join(homedir(), "projects/my app"));
    expect(repoPath("~")).toBe(homedir());
    expect(() => repoPath("my-app")).toThrow(/my-app must be absolute/);
  });

  it("uses repo before directory, even when the workspace does not exist, and rechecks each use", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-repo-folder-"));
    roots.push(root);
    const repo = path.join(root, "repo");
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Person", "-c", "user.email=p@test", "-c", "commit.gpgsign=false", ...args], { cwd: repo });
    git("init", "-q");
    git("commit", "--allow-empty", "-qm", "First");
    const missingWorkspace = path.join(root, "missing-workspace");
    expect(await projectFolder(missingWorkspace, "old-directory", missingWorkspace, repo)).toEqual({ path: realpathSync(repo) });
    expect(await checkFolder(missingWorkspace, "old-directory", undefined, missingWorkspace, root, repo)).toEqual({ path: realpathSync(repo) });
    rmSync(path.join(repo, ".git"), { recursive: true });
    expect(await projectFolder(missingWorkspace, "old-directory", missingWorkspace, repo)).toHaveProperty("error", expect.stringContaining(repo));
    expect(await checkFolder(missingWorkspace, "old-directory", undefined, missingWorkspace, root, repo)).toHaveProperty("error", expect.stringContaining(repo));
  });

  it("treats a Shepherd folder that links to a repo outside the workspace as that repo", () => {
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-linked-"));
    roots.push(root);
    const sandbox = path.join(root, "sandbox");
    const repo = path.join(root, "repo");
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    mkdirSync(path.join(sandbox, "plain"), { recursive: true });
    mkdirSync(path.join(sandbox, "nested", ".git"), { recursive: true });
    symlinkSync(repo, path.join(sandbox, "linked"));
    const board = {
      ...workspace(),
      projects: [
        { id: "linked", name: "Linked", summary: "", directory: "linked" },
        { id: "plain", name: "Plain", summary: "", directory: "plain" },
        { id: "nested", name: "Nested", summary: "", directory: "nested" },
        { id: "missing", name: "Missing", summary: "", directory: "missing" },
        { id: "repo", name: "Repo", summary: "", repo },
      ],
    };
    const links = linkedRepos(board, sandbox);
    expect(links).toEqual([{ id: "linked", repo: realpathSync(repo) }]);
    const next = reducer(board, { type: "linkRepo", ...links[0] });
    expect(next.projects[0]).toEqual({ id: "linked", name: "Linked", summary: "", repo: realpathSync(repo) });
    expect(reducer(next, { type: "linkRepo", id: "linked", repo: "/elsewhere" })).toBe(next);
  });
});
