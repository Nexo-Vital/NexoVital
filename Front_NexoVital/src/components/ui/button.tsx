import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-nv-teal disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-nv-navy text-white hover:bg-nv-navy-600',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border-[1.5px] border-nv-line bg-white text-nv-navy hover:bg-nv-mint',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'text-nv-navy hover:bg-nv-mint',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      // Heights follow the Figma mockup: 48 px by default, 56 px for the main action.
      size: {
        default: 'h-12 rounded-nv-md px-5 font-semibold text-base [&_svg]:size-5',
        sm: 'h-10 rounded-nv-md px-4 font-semibold text-sm',
        lg: 'h-14 rounded-nv-md px-5 font-semibold text-base [&_svg]:size-[22px]',
        icon: 'size-10 rounded-nv-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** Fixed-palette action button from the Figma mockup (`.btn`), for the nv-* screens. */
const nvButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-nv-md px-5 font-semibold text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nv-teal focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        primary: 'bg-nv-navy text-white hover:bg-nv-navy-600',
        secondary: 'border-[1.5px] border-nv-line bg-white text-nv-navy hover:bg-nv-mint',
        emergency: 'bg-nv-red-600 text-white hover:bg-nv-red',
        supply: 'bg-nv-lime text-nv-navy hover:brightness-95',
      },
      size: {
        default: 'h-12 [&_svg]:size-5',
        tall: 'h-14 [&_svg]:size-[22px]',
      },
      full: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      tone: 'primary',
      size: 'default',
      full: true,
    },
  },
);

/** Class list for an nv action button: `nvButton({ tone: 'secondary' })`. */
function nvButton(options?: VariantProps<typeof nvButtonVariants>): string {
  return nvButtonVariants(options);
}

export type { ButtonProps };
export { Button, buttonVariants, nvButton };
