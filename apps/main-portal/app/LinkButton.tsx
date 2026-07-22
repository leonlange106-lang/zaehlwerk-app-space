"use client";

import Link from "next/link";
import { Button, type ButtonProps } from "@mantine/core";

export function LinkButton({ href, ...props }: ButtonProps & { href: string }) {
  return <Button component={Link} href={href} {...props} />;
}
