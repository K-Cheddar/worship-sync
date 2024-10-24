import cn from 'classnames';
import { FunctionComponent, useMemo } from 'react';
import './Icon.scss';

type IconProps = {
  svg: FunctionComponent<React.SVGProps<SVGSVGElement>>,
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | string,
  className?: string,
  alt?: string,
  color?: string
}

const Icon = ({ svg: SVG, size = 'md', className, color, alt } : IconProps) => {

  const width = useMemo(() => {
    switch(size) {
      case 'xs':
        return 'w-2';
      case 'sm':
        return 'w-3';
      case 'md':
        return 'w-4';
      case 'lg':
        return 'w-5';
      case 'xl':
        return 'w-6';
      default:
        return '';
    }
  },[size])

  return (
    <span 
      className={cn('icon', className)} 
      style={{ '--icon-color': color ? color : undefined } as React.CSSProperties}
    >
      <SVG className={width} />
    </span>
  )
}

export default Icon;