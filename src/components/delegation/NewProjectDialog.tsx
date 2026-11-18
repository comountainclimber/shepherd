import { useEffect, useState } from "react";
import { projectDirectory } from "../../model/workspace";
import { workspacePath } from "../../runner/live";
import { refreshFromServer, useShepherd } from "../../store";
import type { Project, RepositoryWorkspace } from "../../model/types";
import { DirectoryPicker } from "./DirectoryPicker";
import { Button, Dialog, Field, Select, TextArea, TextInput } from "../ui";

export function NewProjectDialog() {
  const open = useShepherd((store) => store.ui.newProjectOpen);
  const seq = useShepherd((store) => store.state.seq);
  const projects = useShepherd((store) => store.state.projects);
  const setOpen = useShepherd((store) => store.setNewProjectOpen);
  const setProject = useShepherd((store) => store.setProject);
  const setView = useShepherd((store) => store.setView);
  const dispatch = useShepherd((store) => store.dispatch);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [folder, setFolder] = useState("");
  const [source, setSource] = useState("new");
  const [repo, setRepo] = useState("");
  const [checked, setChecked] = useState<{ input: string; source: string; repo?: string; branch?: string; error?: string } & Partial<RepositoryWorkspace> | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setSummary("");
    setFolder("");
    setSource("new");
    setRepo("");
    setChecked(null);
    setProblem("");
    setBrowsing(false);
  }, [open]);

  useEffect(() => {
    if (!open || source === "new" || !repo.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`${source === "workspace" ? "/api/workspaces" : "/api/projects/repo"}?path=${encodeURIComponent(repo.trim())}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((result) => { if (!controller.signal.aborted) setChecked({ ...result, input: repo, source }); })
        .catch(() => { if (!controller.signal.aborted) setChecked({ input: repo, source, error: "Could not check this path. Try again." }); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, source, repo, projects]);

  const close = () => setOpen(false);
  const suggested = projectDirectory(name, projects);
  const directory = folder.trim().replace(/^\/+|\/+$/g, "") || suggested;
  const badFolder = directory.split("/").some((part) => !part || part === "." || part === "..");
  const checkedInput = checked?.input === repo && checked.source === source;
  const validSource = source === "new" ? !badFolder : checkedInput && !!(source === "workspace" ? checked?.root : checked?.repo);

  return (
    <Dialog
      open={open}
      title="New project"
      subtitle="Use one repository or import a workspace containing several. Steps work in isolated branches."
      onClose={close}
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving || !name.trim() || !validSource}
            onClick={async () => {
              setSaving(true);
              setProblem("");
              if (source === "workspace") {
                try {
                  const response = await fetch("/api/workspaces", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ path: repo.trim(), name: name.trim(), summary: summary.trim() }),
                  });
                  const result = await response.json() as { project?: Project; error?: string };
                  if (!response.ok || !result.project) throw new Error(result.error ?? "Could not import this workspace.");
                  await refreshFromServer();
                  setProject(result.project.id);
                  setView("canvas");
                  close();
                } catch (error) {
                  setProblem(error instanceof Error ? error.message : "Could not import this workspace.");
                } finally { setSaving(false); }
                return;
              }
              let existing: string | undefined;
              if (source === "repo") {
                try {
                  const response = await fetch(`/api/projects/repo?path=${encodeURIComponent(repo.trim())}`);
                  const result = await response.json() as { repo?: string; error?: string };
                  if (!response.ok || !result.repo) throw new Error(result.error ?? "Could not check this path.");
                  existing = result.repo;
                } catch (error) {
                  setProblem(error instanceof Error ? error.message : "Could not check this path.");
                  setSaving(false);
                  return;
                }
              }
              const id = `proj-${seq + 1}`;
              dispatch({
                type: "createProject",
                project: {
                  id,
                  name: name.trim(),
                  summary: summary.trim(),
                  ...(existing ? { repo: existing } : { directory }),
                },
              });
              setProject(id);
              setView("canvas");
              setSaving(false);
              close();
            }}
          >
            {saving ? "Checking…" : source === "workspace" ? "Import workspace" : "Create project"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Name the project" />
        </Field>
        <Field label="Summary">
          <TextArea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What is this work?" />
        </Field>
        <Field label="Location">
          <Select value={source} onChange={(event) => { setSource(event.target.value); setProblem(""); }}>
            <option value="new">New folder in the workspace</option>
            <option value="repo">Repository you already have</option>
            <option value="workspace">Workspace containing repositories</option>
          </Select>
        </Field>
        {source !== "new" ? (
          <>
            <Field label={source === "workspace" ? "Workspace directory" : "Repository path"}>
              <TextInput value={repo} onChange={(event) => { setRepo(event.target.value); setProblem(""); }} placeholder="~/projects/my-app" className="font-mono" autoComplete="off" spellCheck={false} />
            </Field>
            {source === "workspace" ? (
              <>
                <Button onClick={() => setBrowsing(!browsing)}>Browse directories</Button>
                {browsing ? <DirectoryPicker initial={repo} onSelect={(directory) => { setRepo(directory); setBrowsing(false); }} onCancel={() => setBrowsing(false)} /> : null}
              </>
            ) : null}
            <p role="status" aria-live="polite" className="break-words text-[12px] leading-5 text-muted">
              {!repo.trim() ? "Choose a directory on this machine. ~ means your home folder."
                : !checkedInput ? "Checking directory…"
                : checked?.error ?? (source === "workspace" ? `${checked?.repositories?.length} repositories found` : `Checked out: ${checked?.branch}`)}
            </p>
            {checkedInput && checked?.repo ? <p className="break-all font-mono text-[11px] text-faint">{checked.repo}</p> : null}
            {source === "workspace" ? (
              <>
                {checkedInput && checked?.repositories ? <ul className="max-h-28 overflow-y-auto font-mono text-[11px] text-muted">{checked.repositories.map((member) => <li key={member.name}>{member.name}</li>)}</ul> : null}
                <p className="text-[11px] leading-5 text-faint">Imports repositories in immediate subfolders. One task can change several repositories; each gets its own worktree. Files outside those repositories are not copied.</p>
              </>
            ) : null}
            <p className="text-[11px] leading-5 text-faint">Shepherd works in separate folders and branches. Your checkout stays yours until you choose to merge.</p>
          </>
        ) : (
          <>
            <Field label="Folder">
              <TextInput value={folder} onChange={(event) => setFolder(event.target.value)} placeholder={suggested} className="font-mono" />
            </Field>
            <p className="-mt-2 text-[11px] leading-5 text-faint">
              {badFolder ? "Use a folder inside the workspace, without . or .. in the path." : "Shepherd makes this folder a git repository on the first run."}
            </p>
            <p className="break-all font-mono text-[11px] text-faint">{workspacePath() || ".agent-sandbox"}/{directory}</p>
          </>
        )}
        {problem ? <p role="alert" className="break-words text-[12px] text-failed">{problem}</p> : null}
      </div>
    </Dialog>
  );
}
