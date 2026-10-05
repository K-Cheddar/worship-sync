import { useState } from "react";
import { Link2 } from "lucide-react";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import Modal from "../components/Modal/Modal";
import { createExternalChurchResource } from "../api/auth";
import type { ChurchResource } from "../types/churchResource";

export const ExternalResourceDialog = ({
  churchId,
  onCreated,
}: {
  churchId: string;
  onCreated: (resource: ChurchResource) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    if (saving) return;
    setOpen(false);
    setUrl("");
    setName("");
    setDescription("");
    setError("");
  };

  const save = async () => {
    if (saving || !url.trim()) return;
    setSaving(true);
    setError("");
    try {
      const resource = await createExternalChurchResource({
        churchId,
        url: url.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      onCreated(resource);
      setOpen(false);
      setUrl("");
      setName("");
      setDescription("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The link could not be added.");
    } finally {
      setSaving(false);
    }
  };

  return <>
    <Button type="button" variant="tertiary" svg={Link2} onClick={() => setOpen(true)}>Add external link</Button>
    <Modal isOpen={open} onClose={close} title="Add external link" size="md" showCloseButton={!saving}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="text-sm text-gray-300">Link to a document or resource stored elsewhere, such as Google Drive, Dropbox, OneDrive, SharePoint, or Box.</p>
        <Input label="URL" labelClassName="text-white" type="url" required value={url} onChange={(value) => setUrl(String(value))} placeholder="https://" autoFocus />
        <Input label="Name (optional)" labelClassName="text-white" value={name} onChange={(value) => setName(String(value))} />
        <Input label="Description (optional)" labelClassName="text-white" value={description} onChange={(value) => setDescription(String(value))} />
        {saving ? <p className="text-sm text-gray-300" role="status">Checking link and adding resource…</p> : null}
        {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="cta" isLoading={saving} disabled={saving || !url.trim()}>Add resource</Button>
        </div>
      </form>
    </Modal>
  </>;
};
