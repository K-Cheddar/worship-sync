import HistorySuggestField from "../../components/HistorySuggestField";

type CreditHistoryTextAreaProps = {
  value: string;
  onChange: (value: string) => void;
  /** History lines for this credit's heading, used for suggestions. */
  historyLines: string[];
  /** Optional callback to remove a history line from the underlying history store. */
  onRemoveHistoryLine?: (line: string) => void;
};

const CreditHistoryTextArea = ({
  value,
  onChange,
  historyLines,
  onRemoveHistoryLine,
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
  />
);

export default CreditHistoryTextArea;
