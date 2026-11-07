import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

const DialogContext = createContext<(() => void) | null>(null);

export function AlertDialog({
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

export function AlertDialogContent({
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <section role="alertdialog" aria-modal="true" className="dialog" {...props}>
      {children}
    </section>
  );
}

export const AlertDialogHeader = (props: HTMLAttributes<HTMLDivElement>) => (
  <header {...props} />
);
export const AlertDialogFooter = (props: HTMLAttributes<HTMLDivElement>) => (
  <footer className="dialog-footer" {...props} />
);
export const AlertDialogTitle = (props: HTMLAttributes<HTMLHeadingElement>) => (
  <h2 {...props} />
);
export const AlertDialogDescription = (
  props: HTMLAttributes<HTMLParagraphElement>,
) => <p {...props} />;

export function AlertDialogCancel(
  props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const close = useContext(DialogContext);
  return <button type="button" {...props} onClick={props.onClick ?? close ?? undefined} />;
}

export function AlertDialogAction(
  props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return <button type="button" className="button" {...props} />;
}
