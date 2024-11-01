import Select from "../../../components/Select/Select";

const Services = () => {
  return (
    <Select 
    label="Services" 
    labelProps={{ className: 'mr-2' }}
    options={[{ value: 'option1', label: 'Option 1' }, { value: 'option2', label: 'Option 2' }]} value="option1" onChange={() => {}}/>
  )
}

export default Services;