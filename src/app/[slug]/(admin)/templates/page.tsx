import { redirect } from "next/navigation";

/** Email templates live under Settings. This keeps old links and bookmarks working. */
export default async function TemplatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/${slug}/settings?tab=templates`);
}
