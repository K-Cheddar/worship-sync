import './TextArea.scss'

type TextAreaProps = {
  className?: string
  type?: string
  value: string | number
  label?: string
  hideLabel?: boolean,
  onChange: (value: string) => void

}


const TextArea = ({ 
  className, 
  type="text", 
  value, onChange, 
  label, 
  hideLabel = false, 
  ...rest
} : TextAreaProps) => {

  return (
    <div className={`${className} text-area-container`}>
      <label className={`text-sm font-semibold ${hideLabel ? 'sr-only' : ''}`}>{label}:</label>
      <textarea
        className="w-full h-full rounded px-2 py-1 select text-black resize-none text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value) }
        {...rest}
      />
    </div>
  )
}

export default TextArea