import { redirect } from "next/navigation";

/** Email templates now live under Settings. This keeps old links and bookmarks working. */
export default function TemplatesPage() {
  redirect("/admin/settings?tab=templates");
}
