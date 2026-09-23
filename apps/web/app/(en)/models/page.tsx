import { redirect } from "next/navigation";

// The catalog lives on the home page.
export default function Models() {
  redirect("/#models");
}
