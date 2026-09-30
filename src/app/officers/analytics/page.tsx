import PageHeader from "@/components/ui/page-header";
import Placeholder from "@/components/ui/placeholder";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDB } from "@/lib/db";

export default async function AnalyticsDashboardPage() {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/");
  }

  const DB = await getDB();

  // Check if the user is an officer
  const result = await DB.prepare(
    "SELECT id, name, position FROM officers WHERE email = ?",
  )
    .bind(session.user.email)
    .first();

  if (!result) {
    redirect("/");
  }

  return (
    <main className="pt-32 pb-20 px-6 max-w-7xl mx-auto">
      <PageHeader
        title="Analytics Dashboard"
        description="Track and analyze organization metrics and performance."
      >
        <Placeholder
          icon="BarChart3"
          title="Analytics Center"
          message="The analytics dashboard is under development. Soon you'll be able to view member statistics, event participation data, and organizational growth metrics."
          cardSize="full"
        />
      </PageHeader>
    </main>
  );
}
