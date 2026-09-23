import {
  createContext,
  useContext,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

const TabsContext = createContext<{
  value: string;
  setValue: (value: string) => void;
} | null>(null);

export function Tabs({
  defaultValue,
  children,
}: {
  defaultValue: string;
  children: ReactNode;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      {children}
    </TabsContext.Provider>
  );
}

export const TabsList = (props: HTMLAttributes<HTMLDivElement>) => (
  <div className="tabs-list" {...props} />
);

export function TabsTrigger({
  value,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const tabs = useContext(TabsContext);
  return (
    <button
      type="button"
      aria-pressed={tabs?.value === value}
      onClick={() => tabs?.setValue(value)}
      {...props}
    />
  );
}

export function TabsContent({
  value,
  ...props
}: HTMLAttributes<HTMLDivElement> & { value: string }) {
  const tabs = useContext(TabsContext);
  return tabs?.value === value ? <div {...props} /> : null;
}
