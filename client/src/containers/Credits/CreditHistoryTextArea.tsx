import HistorySuggestField from "../../components/HistorySuggestField";

type CreditHistoryTextAreaProps = {
  value: string;
  onChange: (value: string) => void;
  /** History lines from saved credits history, used for suggestions. */
  historyLines: string[];
  /** Optional callback to remove a history line from the underlying history store. */
  onRemoveHistoryLine?: (line: string) => void;
  disabled?: boolean;
  /** Fires when the text field loses focus (e.g. to merge lines into credits history). */
  onFieldBlur?: () => void;
};

const CreditHistoryTextArea = ({
  value,
  onChange,
  historyLines,
  onRemoveHistoryLine,
  disabled = false,
  onFieldBlur,
}: CreditHistoryTextAreaProps) => (
  <HistorySuggestField
    value={value}
    onChange={onChange}
    historyValues={historyLines}
    onRemoveHistoryValue={onRemoveHistoryLine}
    multiline
    label="Text"
    placeholder="Text"
    hideLabel
    autoResize
    data-ignore-undo="true"
    disabled={disabled}
    onFieldBlur={onFieldBlur}
  />
);

export default CreditHistoryTextArea;
