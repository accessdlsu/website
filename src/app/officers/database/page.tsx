import PageHeader from "@/components/ui/page-header";
import Placeholder from "@/components/ui/placeholder";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDB } from "@/lib/db";

export default async function DatabasePage() {
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
        title="Database Center"
        description="Manage and analyze ACCESS organization data."
      >
        <Placeholder
          icon="Database"
          title="Database Management"
          message="Our database management interface is being developed. Soon you'll be able to manage member records, event data, and organizational information."
          cardSize="full"
        />
      </PageHeader>
    </main>
  );
}
