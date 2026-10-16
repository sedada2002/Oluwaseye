"""Judge client. The judge is a separate service that holds the model key.

The desk only sees the interface below, so tests and replays can use a stub.
Responses are returned raw: thresholds are applied by the caller, not here.
"""
import time


class JudgeError(Exception):
    """The judge could not answer. The caller should skip the token, not guess."""


class JudgeRejected(JudgeError):
    """422: the question is malformed. Never retry; the same question will fail again."""


class HttpJudge:
    """Posts {question_set, state} to a judge endpoint with a desk secret."""

    def __init__(self, url: str, secret: str, timeout: float = 30, retries: int = 3):
        self.url = url
        self.secret = secret
        self.timeout = timeout
        self.retries = retries

    def ask(self, question_set: str, state: dict) -> dict:
        import requests  # imported here so the core logic works without it

        for attempt in range(self.retries):
            r = requests.post(self.url, timeout=self.timeout,
                              headers={"Authorization": f"Bearer {self.secret}"},
                              json={"question_set": question_set, "state": state})
            if r.status_code == 422:
                raise JudgeRejected(f"{question_set}: {r.text}")
            if r.status_code in (429, 529) and attempt < self.retries - 1:
                time.sleep(2 ** attempt)  # back off, then retry
                continue
            if r.status_code >= 400:
                raise JudgeError(f"{question_set}: HTTP {r.status_code}")
            return r.json()
        raise JudgeError(f"{question_set}: retries exhausted")
