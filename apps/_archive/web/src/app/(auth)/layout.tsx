import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Auth - ERP71",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white p-8 shadow-md rounded-lg">
        {children}
      </div>
    </div>
  );
}
