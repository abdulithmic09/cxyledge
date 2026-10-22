import { createFileRoute } from "@tanstack/react-router";
import { YardApp } from "@/components/yard/app";

export const Route = createFileRoute("/")({ component: YardApp });
