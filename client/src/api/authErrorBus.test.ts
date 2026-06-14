import { notifyAuthError, registerAuthErrorHandler } from "./authErrorBus";

describe("authErrorBus", () => {
  it("invokes every registered handler on notifyAuthError", () => {
    const a = jest.fn();
    const b = jest.fn();
    const unsubA = registerAuthErrorHandler(a);
    const unsubB = registerAuthErrorHandler(b);

    notifyAuthError();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
    unsubB();
  });

  it("stops calling a handler after it unsubscribes", () => {
    const handler = jest.fn();
    const unsubscribe = registerAuthErrorHandler(handler);

    notifyAuthError();
    unsubscribe();
    notifyAuthError();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing handler from the others", () => {
    const throwing = jest.fn(() => {
      throw new Error("boom");
    });
    const healthy = jest.fn();
    const unsub1 = registerAuthErrorHandler(throwing);
    const unsub2 = registerAuthErrorHandler(healthy);

    expect(() => notifyAuthError()).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });
});
