import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function formatToneClass(prefix: string, tone: Tone = "neutral"): string {
  return `${prefix} ${prefix}--${tone}`;
}

type PolymorphicProps<TElement extends ElementType> = {
  as?: TElement;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<TElement>, "as" | "children" | "className">;

export function Stack<TElement extends ElementType = "div">({
  as,
  className,
  children,
  ...props
}: PolymorphicProps<TElement>) {
  const Component = as ?? "div";

  return (
    <Component className={cx("ui-stack", className)} {...props}>
      {children}
    </Component>
  );
}

export function Cluster<TElement extends ElementType = "div">({
  as,
  className,
  children,
  ...props
}: PolymorphicProps<TElement>) {
  const Component = as ?? "div";

  return (
    <Component className={cx("ui-cluster", className)} {...props}>
      {children}
    </Component>
  );
}
