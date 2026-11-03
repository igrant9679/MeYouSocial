import { redirect } from "next/navigation";

// The company's description, industry and audience have ONE editor: Brand →
// Overview (E-ART-20). This page edited the same fields a second time — and
// its plain description could drift from the rich one Brand keeps. Old links
// land on the section.
export default function OrgProfilePage() {
  redirect("/brand#company");
}
