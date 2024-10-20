import cn from 'classnames';
import { FunctionComponent, useEffect, useRef } from 'react';
import './Icon.scss';

type IconProps = {
  svg: FunctionComponent<React.SVGProps<SVGSVGElement>>,
  width?: 'sm' | 'md' | 'lg' | 'xl' | string,
  className?: string,
  alt?: string,
  color?: string
}

const Icon = ({ svg: SVG, width, className, color, alt } : IconProps) => {

  const size = useRef('');
  
  useEffect(() => {
    switch(width) {
      case 'sm':
        size.current = 'w-2';
        break;
      case 'md':
        size.current = 'w-3';
        break;
      case 'lg':
        size.current = 'w-4';
        break;
      case 'xl':
        size.current = 'w-5';
        break;
      default:
        size.current = '';
        break;
    }
  },[width])

  return (
    <span 
      className={cn('icon', className, size)} 
      style={{ '--icon-color': color ? color : undefined } as React.CSSProperties}
    >
      <SVG />
    </span>
  )
}

export default Icon;