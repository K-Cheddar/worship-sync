import { useEffect, useRef, useState } from "react";
import Input from "../../components/Input/Input";

type DisplayNameFieldProps = {
  name: string;
  onCommit: (name: string) => void;
};

/**
 * Display name editor that commits on blur or Enter.
 *
 * Persisting per keystroke would rewrite the church registry on every character
 * and fight remote sync mid-edit, so the draft stays local until the operator
 * finishes. Remote renames still land: the draft resyncs whenever the stored
 * name changes and the field is not being edited.
 */
const DisplayNameField = ({ name, onCommit }: DisplayNameFieldProps) => {
  const [draft, setDraft] = useState(name);
  const isEditingRef = useRef(false);

  useEffect(() => {
    if (!isEditingRef.current) setDraft(name);
  }, [name]);

  const commit = () => {
    isEditingRef.current = false;
    const next = draft.trim();
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    onCommit(next);
  };

  return (
    <Input
      className="min-w-0 flex-1"
      hideLabel
      label={`Name for ${name}`}
      aria-label={`Name for ${name}`}
      value={draft}
      onFocus={() => {
        isEditingRef.current = true;
      }}
      onChange={(value) => setDraft(String(value))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(name);
          isEditingRef.current = false;
          event.currentTarget.blur();
        }
      }}
    />
  );
};

export default DisplayNameField;
