import { notFound } from "next/navigation";

// With a root layout per language there is no app-wide 404; unknown paths land here.
export default function Missing() {
  notFound();
}
