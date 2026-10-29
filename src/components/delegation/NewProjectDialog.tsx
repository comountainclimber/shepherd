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

  useEffect(() => {
    if (!open) return;
    setName("");
    setSummary("");
  }, [open]);

  const close = () => setOpen(false);
  const directory = projectDirectory(name, projects);

  return (
    <Dialog
      open={open}
      title="New project"
      subtitle="A project is an empty canvas with its own folder. Agents run inside that folder."
      onClose={close}
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
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
        <p className="font-mono text-[11px] text-faint">
          Folder: {workspacePath() || ".agent-sandbox"}/{directory}
        </p>
      </div>
    </Dialog>
  );
}
