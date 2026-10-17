import { describe, expect, it } from "vite-plus/test";
import { sanitizeCause, sanitizeCommandString } from "../src/sanitize.js";

describe("Sanitization Regression Tests", () => {
  describe("Quoted secrets containing spaces", () => {
    it("should fully redact quoted secrets with spaces in CLI flags", () => {
      const input = 'npm run build --secret "my secret phrase with spaces" --other-flag';
      const output = sanitizeCommandString(input);
      expect(output).toBe("npm run build --secret *** --other-flag");
      expect(output).not.toContain("my secret phrase with spaces");
    });

    it("should fully redact single-quoted secrets with spaces in CLI flags", () => {
      const input = "npm run build --token 'token with spaces' --password='pass with spaces'";
      const output = sanitizeCommandString(input);
      expect(output).toBe("npm run build --token *** --password=***");
      expect(output).not.toContain("token with spaces");
      expect(output).not.toContain("pass with spaces");
    });
  });

  describe("Sensitive CLI flags, environment assignments, Bearer credentials, and URL credentials", () => {
    it("should redact sensitive environment variable assignments", () => {
      const input = 'NPM_TOKEN=npm_12345 GITHUB_TOKEN="ghp_secret value" NODE_AUTH_TOKEN=\'secret_node_token\' AWS_SECRET_ACCESS_KEY=supersecret';
      const output = sanitizeCommandString(input);
      expect(output).toBe("NPM_TOKEN=*** GITHUB_TOKEN=*** NODE_AUTH_TOKEN=*** AWS_SECRET_ACCESS_KEY=***");
      expect(output).not.toContain("npm_12345");
      expect(output).not.toContain("ghp_secret value");
      expect(output).not.toContain("secret_node_token");
      expect(output).not.toContain("supersecret");
    });

    it("should redact Bearer credentials in headers or authorization strings", () => {
      const input1 = "Authorization: Bearer secret_bearer_token_12345";
      const input2 = 'Authorization: Bearer "secret token with spaces"';

      const output1 = sanitizeCommandString(input1);
      const output2 = sanitizeCommandString(input2);

      expect(output1).toBe("Authorization: Bearer ***");
      expect(output1).not.toContain("secret_bearer_token_12345");

      expect(output2).toBe("Authorization: Bearer ***");
      expect(output2).not.toContain("secret token with spaces");
    });

    it("should redact URL credentials with or without passwords and ports", () => {
      const url1 = "https://user:password123@github.com/org/repo.git";
      const url2 = "http://token_only@custom-registry.internal:8080/npm";

      const output1 = sanitizeCommandString(url1);
      const output2 = sanitizeCommandString(url2);

      expect(output1).toBe("https://***:***@github.com/org/repo.git");
      expect(output1).not.toContain("user");
      expect(output1).not.toContain("password123");

      expect(output2).toBe("http://***:***@custom-registry.internal:8080/npm");
      expect(output2).not.toContain("token_only");
    });

    it("should preserve non-sensitive command arguments and diagnostic context", () => {
      const input = "npm run test --dir ./src --verbose --timeout=5000";
      const output = sanitizeCommandString(input);
      expect(output).toBe("npm run test --dir ./src --verbose --timeout=5000");
    });
  });

  describe("Nested error causes and circular references in sanitizeCause()", () => {
    it("should sanitize deeply nested error causes", () => {
      const deepError = new Error("Top error containing NPM_TOKEN=secret_123");
      deepError.cause = new Error('Sub error containing --secret "deep secret"');

      const sanitized = sanitizeCause(deepError) as any;
      expect(sanitized.name).toBe("Error");
      expect(sanitized.message).toBe("Top error containing NPM_TOKEN=***");
      expect(sanitized.message).not.toContain("secret_123");

      expect(sanitized.cause).toBeDefined();
      expect(sanitized.cause.name).toBe("Error");
      expect(sanitized.cause.message).toBe("Sub error containing --secret ***");
      expect(sanitized.cause.message).not.toContain("deep secret");
    });

    it("should handle circular references in error objects and plain object causes gracefully", () => {
      const circularObj: any = { key: "GITHUB_TOKEN=secret_token" };
      circularObj.self = circularObj;

      const sanitizedObj = sanitizeCause(circularObj) as any;
      expect(sanitizedObj.key).toBe("GITHUB_TOKEN=***");
      expect(sanitizedObj.self).toBe("[Circular]");

      const circularError: any = new Error("Circular error with GITHUB_TOKEN=secret_token");
      circularError.self = circularError;

      const sanitizedError = sanitizeCause(circularError) as any;
      expect(sanitizedError.message).toBe("Circular error with GITHUB_TOKEN=***");
      expect(sanitizedError.self).toEqual({ name: "Error", message: "[Circular]" });
    });
  });
});
