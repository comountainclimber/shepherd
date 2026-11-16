import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RepositoryWorkspace } from "../src/model/types";
import * as git from "./git";

interface Member {
  name: string;
  repo: string;
  base: string;
  tree?: git.Worktree;
}

interface Group extends git.Worktree {
  owner: string;
  members: Member[];
}

/** Keeps group metadata beside, not inside, the directory an agent can edit. */
export function workspaceGit(workspace: RepositoryWorkspace, root: string) {
  const folderFor = (branch: string) => git.worktreeFolder(root, workspace.root, branch);
  const load = (branch: string): Group => {
    if (!git.isTaskBranch(branch)) throw new git.GitError(`Not a Shepherd workspace branch: ${branch}`);
    return JSON.parse(readFileSync(`${folderFor(branch)}.json`, "utf8")) as Group;
  };
  const save = (group: Group) => {
    mkdirSync(path.dirname(group.folder), { recursive: true });
    writeFileSync(`${group.folder}.json.tmp`, JSON.stringify(group));
    renameSync(`${group.folder}.json.tmp`, `${group.folder}.json`);
  };
  const groupAt = (folder: string): Group => JSON.parse(readFileSync(`${folder}.json`, "utf8")) as Group;
  const trees = (group: Group) => group.members.map((member) => {
    if (!member.tree) throw new git.GitError(`The workspace folder for ${member.name} is incomplete. Run the step again.`);
    return { ...member, tree: member.tree };
  });
  const memberFor = (group: Group, name: string) => {
    const member = trees(group).find((item) => item.name === name);
    if (!member) throw new git.GitError(`Repository ${name} is missing from workspace branch ${group.branch}.`);
    return member;
  };
  const readHeads = (value: string | undefined): string[] | undefined => value === undefined ? undefined : JSON.parse(value) as string[];

  async function open(
    owner: string, name: string, branch: string | undefined, target?: Group,
  ): Promise<Group> {
    if (!git.isTaskName(name)) throw new git.GitError(`Not a usable folder name: ${name}`);
    let group: Group | undefined;
    if (branch) {
      group = load(branch);
      if (group.owner !== owner) throw new git.GitError(`Workspace branch ${branch} no longer belongs to this task.`);
    } else {
      const prefix = target ? "shepherd-step" : "shepherd";
      for (let index = 1; !group; index += 1) {
        const candidate = `${prefix}/${name}${index === 1 ? "" : `-${index}`}`;
        if (existsSync(`${folderFor(candidate)}.json`)) {
          const previous = load(candidate);
          if (previous.owner === owner) group = previous;
        } else if (!existsSync(folderFor(candidate))) {
          const members: Member[] = [];
          for (const member of workspace.repositories) {
            const inspected = await git.inspectRepo(member.repo);
            if (inspected.branch.startsWith("detached at ")) throw new git.GitError(`${member.name} is not on a branch. Check out a branch before starting this task.`);
            members.push({ ...member, base: inspected.branch });
          }
          group = {
            repo: workspace.root, branch: candidate, folder: folderFor(candidate),
            target: target?.branch ?? "workspace base", owner, members,
          };
          save(group);
        }
      }
    }
    mkdirSync(group.folder, { recursive: true });
    for (const member of group.members) {
      const upstream = target && memberFor(target, member.name);
      const start = upstream?.tree.branch ?? member.base;
      if (member.tree && owner.startsWith("goal:")) {
        const owned = await git.git(member.repo, ["config", "--get", `branch.${member.tree.branch}.shepherdtask`]);
        const exists = await git.git(member.repo, ["rev-parse", "--verify", `refs/heads/${member.tree.branch}`]);
        if (exists.code !== 0 || owned.stdout.trim() !== owner) throw new git.GitError(`The task branch for ${member.name} is missing or no longer belongs to this task.`);
      }
      member.tree = await git.openWorktree(member.repo, root, owner, name, member.tree?.branch, {
        start, prefix: target ? "shepherd-step" : "shepherd", folder: path.join(group.folder, member.name),
      });
      save(group);
    }
    return group;
  }

  async function changes(folder: string, branch: string, diffBase?: string): Promise<git.Changes> {
    const members = trees(groupAt(folder));
    const bases = readHeads(diffBase);
    const results: git.Changes[] = [];
    for (const [index, member] of members.entries()) {
      results.push(await git.changes(member.tree.folder, member.tree.branch, bases?.[index]));
    }
    return {
      head: JSON.stringify(results.map((result) => result.head)),
      files: results.flatMap((result, index) => result.files.map((file) => `${members[index]!.name}/${file}`)),
      diffs: results.flatMap((result, index) => result.diffs.map((file) => ({ ...file, path: `${members[index]!.name}/${file.path}` }))),
    };
  }

  return {
    inspectRepo: async () => ({ repo: workspace.root, branch: "workspace base" }),
    ensureRepo: async () => workspace.root,
    openGoalWorktree: async (_repo: string, _root: string, id: string, name: string, saved?: { branch?: string; base?: string }) =>
      open(`goal:${id}`, name, saved?.branch),
    openWorktree: async (_repo: string, _root: string, id: string, name: string, branch?: string, options: { start?: string; prefix?: "shepherd" | "shepherd-step" } = {}) => {
      if (!options.start) throw new git.GitError("A workspace step needs a task branch.");
      return open(id, name, branch, load(options.start));
    },
    prepareRun: async (tree: git.Worktree, upstream: string[], author: git.Author, options: { keepConflicts?: boolean } = {}) => {
      const merged = new Set<string>();
      for (const member of trees(groupAt(tree.folder))) {
        const sources = upstream.map((branch) => memberFor(load(branch), member.name).tree.branch);
        const result = await git.prepareRun(member.tree, sources, author, options);
        for (const source of result) merged.add(upstream[sources.indexOf(source)]!);
      }
      return [...merged];
    },
    commitAll: async (folder: string, message: string[], author: git.Author) => {
      let committed = false;
      for (const member of trees(groupAt(folder))) committed = await git.commitAll(member.tree.folder, message, author) || committed;
      return committed;
    },
    head: async (folder: string) => {
      const heads: string[] = [];
      for (const member of trees(groupAt(folder))) heads.push(await git.head(member.tree.folder));
      return JSON.stringify(heads);
    },
    changes,
    mergeConflict: async (folder: string) => {
      const files: string[] = [];
      const sources = new Set<string>();
      for (const member of trees(groupAt(folder))) {
        const conflict = await git.mergeConflict(member.tree.folder);
        if (conflict) {
          sources.add(conflict.source);
          files.push(...conflict.files.map((file) => `${member.name}/${file}`));
        }
      }
      return sources.size ? { source: [...sources].join(", "), files } : null;
    },
    mergeBranch: async (folder: string, branch: string, message: string, expectedInto?: string) => {
      const source = trees(load(branch));
      const destination = folder === workspace.root ? undefined : groupAt(folder);
      const operations = source.map((member) => {
        const into = destination && memberFor(destination, member.name).tree;
        return { member, folder: into?.folder ?? member.repo, expected: into?.branch ?? member.base };
      });
      if (destination && expectedInto && expectedInto !== destination.branch) throw new git.GitError("The destination workspace branch changed.");
      // Check every repository before touching any checkout. Git cannot atomically merge across repositories.
      for (const operation of operations) {
        const { member, folder, expected } = operation;
        if ((await git.inspectRepo(folder)).branch !== expected) throw new git.GitError(`${member.name} is no longer on ${expected}. Switch it back before merging.`);
        const status = await git.git(folder, ["status", "--porcelain"]);
        if (status.code !== 0) throw new git.GitError(`Could not check ${member.name}: ${status.stderr}`);
        if (status.stdout.trim()) throw new git.DirtyWorktreeError(`${member.name} has uncommitted changes. Commit or stash them before merging.`);
        const preview = await git.git(folder, ["merge-tree", "--write-tree", "HEAD", member.tree.branch]);
        if (preview.code !== 0) throw new git.MergeConflictError(`Merging ${member.name} conflicts or could not be checked. Nothing was changed.\n${preview.stdout}${preview.stderr}`, [member.name]);
      }
      const completed: string[] = [];
      const heads: string[] = [];
      for (const operation of operations) {
        try {
          const result = await git.mergeBranch(operation.folder, operation.member.tree.branch, message, operation.expected);
          heads.push(result.sha);
          completed.push(operation.member.name);
        } catch (error) {
          throw new git.GitError(`Workspace merge stopped. Already merged: ${completed.join(", ") || "none"}. Retry after fixing ${operation.member.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { into: expectedInto ?? "workspace base", sha: JSON.stringify(heads) };
    },
    markAccepted: async (folder: string, branch: string) => {
      const source = load(branch);
      for (const member of trees(groupAt(folder))) {
        await git.markAccepted(member.tree.folder, memberFor(source, member.name).tree.branch);
      }
    },
    personAuthor: async () => git.personAuthor(workspace.repositories[0]!.repo),
    taskPushRemote: async (): Promise<string> => {
      throw new git.GitError("Automatic push and merge-request steps are not supported for multi-repository workspaces. Push and open a request for each repository separately.");
    },
    pushTaskBranch: git.pushTaskBranch,
  };
}
