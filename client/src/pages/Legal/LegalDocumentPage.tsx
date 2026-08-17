import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import WorshipSyncImage from "../../assets/WorshipSyncImage.png";

type LegalDocumentPageProps = {
  title: string;
  effectiveDate: string;
  children: ReactNode;
};

/**
 * Public legal document shell (privacy, terms). No auth chrome — reachable
 * without a session so store listings and sign-up flows can deep-link here.
 */
const LegalDocumentPage = ({
  title,
  effectiveDate,
  children,
}: LegalDocumentPageProps) => {
  return (
    <main className="h-dvh overflow-y-auto overscroll-y-contain bg-homepage-canvas text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col items-center gap-4 border-b border-gray-700 pb-6 text-center">
          <Link
            to="/"
            className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
          >
            <img
              src={WorshipSyncImage}
              alt="WorshipSync"
              className="mx-auto max-w-[40%]"
              width={200}
              height={183}
              loading="eager"
            />
          </Link>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
            <p className="text-sm text-gray-300">
              Effective date: {effectiveDate}
            </p>
          </div>
        </header>

        <article className="space-y-6 text-sm leading-relaxed text-gray-100 [&_a]:font-medium [&_a]:text-orange-300 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-orange-200 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-white [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p]:text-gray-200 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </article>

        <footer className="mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-gray-700 pt-6 text-sm text-gray-300">
          <Link
            to="/"
            className="font-medium text-gray-100 underline underline-offset-2 hover:text-white"
          >
            Back to WorshipSync
          </Link>
          <span aria-hidden className="text-gray-600">
            ·
          </span>
          <Link
            to="/privacy"
            className="underline underline-offset-2 hover:text-white"
          >
            Privacy Policy
          </Link>
          <span aria-hidden className="text-gray-600">
            ·
          </span>
          <Link
            to="/terms"
            className="underline underline-offset-2 hover:text-white"
          >
            Terms of Service
          </Link>
        </footer>
      </div>
    </main>
  );
};

export default LegalDocumentPage;
