$('signIn').onclick = async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    notify(
      'Google Login Error: ' + e.code + ' — ' + e.message,
      true
    );
  }
};
