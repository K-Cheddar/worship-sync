import './Input.scss'

type InputProps = {
  className?: string
  type?: string
  value: string | number
  label?: string
  hideLabel?: boolean,
  onChange: (value: string | number | Date) => void

}

const Input = ({ 
  className, 
  type="text", 
  value, onChange, 
  label, 
  hideLabel = false, 
  ...rest
} : InputProps) => {

  return (
    <div className={`${className} input-container`}>
      <label className={`text-sm font-semibold ${hideLabel ? 'sr-only' : ''}`}>{label}:</label>
      <input
        className="w-full rounded px-2 py-1 text-black"
        type={type}
        value={value}
        onChange={(e) => {
          const val = e.target.value;
          if (type === 'number') {
            onChange(Number(val))
          } else if (type === 'date') {
            onChange(new Date(val))
          } else {
            onChange(e.target.value)
          }
        } }
        {...rest}
      />
    </div>
  )
}

export default Input