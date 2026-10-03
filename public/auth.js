// Shared client-side logic for login.html and signup.html.
(function () {
  function showError(errorEl, textEl, message) {
    textEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  function hideError(errorEl) {
    errorEl.classList.add('hidden');
  }

  window.initAuthPage = function initAuthPage({ mode, formId, submitBtnId, errorId, errorTextId }) {
    const form = document.getElementById(formId);
    const submitBtn = document.getElementById(submitBtnId);
    const errorEl = document.getElementById(errorId);
    const errorTextEl = document.getElementById(errorTextId);
    const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';

    // If already logged in, skip straight to the app.
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d && d.user) window.location.replace('/');
      })
      .catch(() => {});

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError(errorEl);

      const username = form.username.value.trim();
      const password = form.password.value;

      if (!username || !password) {
        showError(errorEl, errorTextEl, 'Please fill in both fields.');
        return;
      }

      if (mode === 'signup') {
        const confirmPassword = form.confirmPassword ? form.confirmPassword.value : password;
        if (password !== confirmPassword) {
          showError(errorEl, errorTextEl, 'Passwords do not match.');
          return;
        }
      }

      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = mode === 'signup' ? 'Signing up…' : 'Logging in…';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || 'Something went wrong. Please try again.');
        }
        window.location.replace('/');
      } catch (err) {
        showError(errorEl, errorTextEl, err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });
  };
})();
