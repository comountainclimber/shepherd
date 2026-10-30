import { useEffect, useState } from "react";
import { projectDirectory } from "../../model/workspace";
import { workspacePath } from "../../runner/live";
import { useShepherd } from "../../store";
import { Button, Dialog, Field, TextArea, TextInput } from "../ui";

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

  useEffect(() => {
    if (!open) return;
    setName("");
    setSummary("");
    setFolder("");
  }, [open]);

  const close = () => setOpen(false);
  const suggested = projectDirectory(name, projects);
  const directory = folder.trim().replace(/^\/+|\/+$/g, "") || suggested;
  const badFolder = directory.split("/").some((part) => !part || part === "." || part === "..");

  return (
    <Dialog
      open={open}
      title="New project"
      subtitle="A project is a canvas backed by one git repository. Each agent task works on its own branch of it."
      onClose={close}
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || badFolder}
            onClick={() => {
              const id = `proj-${seq + 1}`;
              dispatch({
                type: "createProject",
                project: {
                  id,
                  name: name.trim(),
                  summary: summary.trim(),
                  directory,
                },
              });
              setProject(id);
              setView("canvas");
              close();
            }}
          >
            Create project
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
        <Field label="Folder">
          <TextInput value={folder} onChange={(event) => setFolder(event.target.value)} placeholder={suggested} className="font-mono" />
        </Field>
        <p className="-mt-2 text-[11px] leading-5 text-faint">
          {badFolder
            ? "Use a folder inside the workspace, without . or .. in the path."
            : "Name an existing repository's folder to work on it. Any other folder becomes a new repository on the first run."}
        </p>
        <p className="break-all font-mono text-[11px] text-faint">
          {workspacePath() || ".agent-sandbox"}/{directory}
        </p>
      </div>
    </Dialog>
  );
}
