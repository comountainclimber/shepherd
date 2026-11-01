import { useEffect, useState } from "react";
import { projectDirectory } from "../../model/workspace";
import { workspacePath } from "../../runner/live";
import { useShepherd } from "../../store";
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
  const [checked, setChecked] = useState<{ input: string; repo?: string; branch?: string; error?: string } | null>(null);
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
  }, [open]);

  useEffect(() => {
    if (!open || source !== "repo" || !repo.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/projects/repo?path=${encodeURIComponent(repo.trim())}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((result) => { if (!controller.signal.aborted) setChecked({ ...result, input: repo }); })
        .catch(() => { if (!controller.signal.aborted) setChecked({ input: repo, error: "Could not check this path. Try again." }); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, source, repo, projects]);

  const close = () => setOpen(false);
  const suggested = projectDirectory(name, projects);
  const directory = folder.trim().replace(/^\/+|\/+$/g, "") || suggested;
  const badFolder = directory.split("/").some((part) => !part || part === "." || part === "..");

  return (
    <Dialog
      open={open}
      title="New project"
      subtitle="A project is one git repository. Steps work on their own branches."
      onClose={close}
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving || !name.trim() || (source === "repo" ? checked?.input !== repo || !checked.repo : badFolder)}
            onClick={async () => {
              setSaving(true);
              setProblem("");
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
            {saving ? "Checking…" : "Create project"}
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
          </Select>
        </Field>
        {source === "repo" ? (
          <>
            <Field label="Repository path">
              <TextInput value={repo} onChange={(event) => { setRepo(event.target.value); setProblem(""); }} placeholder="~/projects/my-app" className="font-mono" autoComplete="off" spellCheck={false} />
            </Field>
            <p role="status" aria-live="polite" className="break-words text-[12px] leading-5 text-muted">
              {!repo.trim() ? "Paste the full path to a repository on this Mac. ~ means your home folder."
                : checked?.input !== repo ? "Checking repository…"
                : checked.error ?? `Checked out: ${checked.branch}`}
            </p>
            {checked?.input === repo && checked.repo ? <p className="break-all font-mono text-[11px] text-faint">{checked.repo}</p> : null}
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
