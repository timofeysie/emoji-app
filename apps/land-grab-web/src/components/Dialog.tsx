import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

const DialogContext = createContext<(() => void) | null>(null);

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <DialogContext.Provider value={() => onOpenChange(false)}>
      <div className="dialog-backdrop" role="presentation">
        {children}
      </div>
    </DialogContext.Provider>
  );
}

export function DialogContent({
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <section role="dialog" aria-modal="true" className="dialog" {...props}>
      {children}
    </section>
  );
}

export const DialogHeader = (props: HTMLAttributes<HTMLDivElement>) => (
  <header {...props} />
);

export const DialogFooter = (props: HTMLAttributes<HTMLDivElement>) => (
  <footer className="dialog-footer" {...props} />
);

export const DialogTitle = (props: HTMLAttributes<HTMLHeadingElement>) => (
  <h2 {...props} />
);

export const DialogDescription = (
  props: HTMLAttributes<HTMLParagraphElement>,
) => <p {...props} />;

export function DialogClose(
  props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const close = useContext(DialogContext);
  return (
    <button
      type="button"
      {...props}
      onClick={props.onClick ?? close ?? undefined}
    />
  );
}
