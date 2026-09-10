import { FormEvent, useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AuthApiError, submitSupportContact } from "../api/auth";
import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import AuthScreenMain from "../components/AuthScreenMain";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import TextArea from "../components/TextArea/TextArea";
import { GlobalInfoContext } from "../context/globalInfo";

export const SUPPORT_EMAIL = "support@worshipsync.net";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

/**
 * Public support page. Reachable without a session. Prefers an in-app form so
 * church machines without a mail client can still reach support; mailto stays
 * as a fallback. When signed in, name / email / church are prefilled.
 */
const Support = () => {
  const context = useContext(GlobalInfoContext);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [churchName, setChurchName] = useState("");
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didSend, setDidSend] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (context?.loginState !== "success") {
      return;
    }
    const sessionName = context.user?.trim() || "";
    const sessionEmail = context.userEmail?.trim() || "";
    const sessionChurch = context.churchName?.trim() || "";
    // Only fill blanks so we never overwrite what the operator already typed.
    if (sessionName) {
      setName((current) => current || sessionName);
    }
    if (sessionEmail) {
      setEmail((current) => current || sessionEmail);
    }
    if (sessionChurch) {
      setChurchName((current) => current || sessionChurch);
    }
  }, [
    context?.loginState,
    context?.user,
    context?.userEmail,
    context?.churchName,
  ]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || didSend) {
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);
    try {
      await submitSupportContact({
        name,
        email,
        churchName,
        message,
        company: honeypot,
      });
      setDidSend(true);
    } catch (error) {
      const nextMessage =
        error instanceof AuthApiError
          ? error.message
          : "Could not send your message. Try again or email support.";
      setErrorMessage(nextMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthScreenMain>
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="w-full rounded-2xl border border-gray-500 bg-gray-800 p-6 text-center sm:p-8">
          <img
            src={WorshipSyncImage}
            alt="WorshipSync"
            className="mx-auto mb-5 w-[58%] max-w-[13.5rem]"
            width={216}
            height={198}
            loading="eager"
          />

          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Support
            </h1>
            <p className="text-sm leading-relaxed text-gray-300">
              Need help with WorshipSync? Send a message and we&apos;ll get back
              to you.
            </p>
          </div>

          {didSend ? (
            <div
              className="mt-6 space-y-3 rounded-xl border border-gray-600 bg-gray-900/50 px-4 py-5 text-left"
              role="status"
            >
              <p className="text-base font-medium text-white">Message sent</p>
              <p className="text-sm leading-relaxed text-gray-300">
                Thanks. We&apos;ll reply to the email you provided.
              </p>
            </div>
          ) : (
            <form
              className="relative mt-6 flex w-full flex-col gap-4 text-left"
              onSubmit={handleSubmit}
              noValidate
            >
              <Input
                label="Name"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(value) => setName(String(value))}
                required
                maxLength={100}
              />
              <Input
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(value) => setEmail(String(value))}
                required
                maxLength={320}
                helperText="We'll reply to this address."
              />
              <Input
                label="Church name"
                name="churchName"
                autoComplete="organization"
                value={churchName}
                onChange={(value) => setChurchName(String(value))}
                maxLength={120}
                helperText="Optional"
              />
              <TextArea
                label="How can we help?"
                name="message"
                value={message}
                onChange={setMessage}
                required
                rows={5}
                maxLength={5000}
                className="w-full"
              />
              {/* Honeypot: hidden from operators, filled by simple bots. */}
              <div
                className="absolute -left-[9999px] h-0 w-0 overflow-hidden"
                aria-hidden="true"
              >
                <label>
                  Company
                  <input
                    type="text"
                    name="company"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(event) => setHoneypot(event.target.value)}
                  />
                </label>
              </div>
              {errorMessage ? (
                <p className="text-sm text-red-300" role="alert">
                  {errorMessage}
                </p>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                className="w-full cursor-pointer justify-center"
                isLoading={isSubmitting}
                disabled={isSubmitting}
              >
                Send message
              </Button>
            </form>
          )}

          <p className="mt-6 text-sm text-gray-400">
            Prefer email?{" "}
            <a
              href={SUPPORT_MAILTO}
              className="cursor-pointer font-medium text-orange-300 underline underline-offset-2 hover:text-orange-200"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>

        <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-gray-300">
          <Link
            to="/privacy"
            className="cursor-pointer underline underline-offset-2 hover:text-white"
          >
            Privacy Policy
          </Link>
          <span aria-hidden className="text-gray-600">
            ·
          </span>
          <Link
            to="/terms"
            className="cursor-pointer underline underline-offset-2 hover:text-white"
          >
            Terms of Service
          </Link>
        </footer>
      </div>
    </AuthScreenMain>
  );
};

export default Support;
