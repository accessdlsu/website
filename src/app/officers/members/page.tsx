import PageHeader from "@/components/ui/page-header";
import Placeholder from "@/components/ui/placeholder";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDB } from "@/lib/db";

export default async function MemberManagementPage() {
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
        title="Member Management"
        description="Manage ACCESS member records and applications."
      >
        <Placeholder
          icon="UserCheck"
          title="Member Administration"
          message="The member management system is under development. Soon you'll be able to review applications, manage member status, and update member information."
          cardSize="full"
        />
      </PageHeader>
    </main>
  );
}
