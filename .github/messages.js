// Reminder messages, "sarcastic best friend" voice. n = your streak, f = freezes left.
// Add or edit lines freely: each one is `(n, f) => \`text\``.
const s = f => (f === 1 ? '' : 's');

module.exports = {
  // Right after study hall ends (streak 1 or more)
  sh: [
    n => `Day ${n} 🔥 — don't let it die. I'm not writing the eulogy.`,
    n => `Streak: ${n} 🔥. Study hall's over. Did you work or did you "work"?`,
    n => `${n} in a row. Log it before I start assuming things.`,
    n => `Study hall's done. Your ${n}-streak is staring at you. Log it.`,
    n => `Be honest: homework or phone? Your ${n} 🔥 wants to know.`,
    n => `${n} straight. Honestly shocking. Keep shocking me — log it.`,
    n => `Your streak (${n} 🔥) called. It said "log me, coward."`,
    n => `Imagine losing a ${n}-streak because you forgot to tap a button. Couldn't be you. Right?`,
    n => `Not saying you slacked. Saying log it and prove me wrong. (${n} 🔥)`,
    n => `Day ${n}. You're basically a productive person now. Weird. Log it.`,
    n => `Logging takes 3 seconds. Your ${n} 🔥 took way longer. Protect it.`,
    n => `Plot twist: you actually did homework? Log it. Streak: ${n} 🔥`,
    n => `${n} 🔥 and counting… if you log it. Just saying.`,
    n => `Study hall's over. Pretending it didn't happen isn't a strategy. (${n} 🔥)`,
    n => `Your ${n}-streak is doing great. Don't be the reason it isn't.`,
    n => `Message from your least chill friend: log study hall. ${n} 🔥`,
    n => `If you slacked, admit it. If you didn't, flex it. Either way: log it. (${n} 🔥)`,
    n => `${n} study halls of not slacking. Who ARE you? Log it.`,
    n => `Tap. Log. Done. Protect the ${n} 🔥.`,
    n => `Day ${n} 🔥. Your future self says thanks. Your present self needs to log it.`,
    (n, f) => `Day ${n} 🔥. You've got ${f} freeze${s(f)}, but don't get cocky. Log it.`,
    n => `Study hall ended. ${n} 🔥 is waiting. I'm waiting. We're all waiting.`,
  ],
  // Right after study hall ends, streak is 0
  sh0: [
    () => `Streak: 0. Tragic. Log Homework now and it's back to 1.`,
    () => `Current streak: zero. Rock bottom has a nice view. Log Homework and climb out.`,
    () => `Study hall's over. Streak's 0, so honestly nowhere to go but up.`,
    () => `0 🔥. Even a streak of 1 is infinitely better. That's math. Log it.`,
    () => `No streak to protect = zero pressure. Log it anyway.`,
  ],
  // Right after study hall ends, streak JUST broke (Homework now earns a comeback freeze)
  shBack: [
    () => `Your streak died. RIP. Log Homework right now for a comeback freeze 🧊`,
    () => `Streak broke. Comeback bonus is on the table: log Homework and get a free freeze.`,
    () => `Villain origin story or comeback arc? Log Homework and earn a freeze 🧊`,
    () => `Streak: 0. But Homework now = comeback freeze. Don't fumble this twice.`,
  ],
  // 6:50 PM evening check (streak 1 or more)
  eve: [
    n => `Evening check 🌙 Any homework tonight that was assigned before today? Be honest. (${n} 🔥)`,
    n => `Did past-you leave homework for present-you again? Evening check time. (${n} 🔥)`,
    n => `Day ${n} 🔥. Real question: is there old homework hiding in your backpack?`,
    n => `Evening check before you "just watch one video." We both know how that ends. (${n} 🔥)`,
    n => `Night check: about to do Tuesday's homework on Thursday? (${n} 🔥)`,
    n => `6:50 check-in. Lying to an app is a new low, so just answer. (${n} 🔥)`,
    n => `Evening check. One tap. You've survived harder things. Probably. Day ${n} 🔥`,
    n => `Your ${n}-streak did the work at school. Did night-you do the same? Check in.`,
    n => `Evening question time. "I'll do it later" is not an answer. (${n} 🔥)`,
    n => `Doing homework that was due… a while ago? Asking for a friend. The friend is me. (${n} 🔥)`,
    n => `Day ${n} 🔥. Tell me you're not starting a 3-day-old worksheet right now.`,
    n => `Quick evening check. Faster than finding a charger. (${n} 🔥)`,
    n => `It's evening check o'clock. ${n} 🔥 says you're responsible now. Prove it.`,
    n => `Be honest: any homework you've been dodging since last week? (${n} 🔥)`,
    n => `Evening check. I won't judge. (I will, a little.) Day ${n} 🔥`,
    n => `Your backpack has secrets. Evening check time. (${n} 🔥)`,
    n => `Streak ${n} 🔥 — evening check. Old homework tonight: yes or no?`,
    n => `Evening check! Tap it before your brain enters "rest mode" forever. (${n} 🔥)`,
    n => `The procrastination police are here. Evening check, please. (${n} 🔥)`,
    n => `Day ${n} 🔥. Tonight's question: is future-you going to be mad at present-you?`,
    n => `Evening check. Takes 2 seconds, unlike the essay you're avoiding. (${n} 🔥)`,
    n => `Hey. Evening check. Don't leave me on read. (${n} 🔥)`,
  ],
  // 6:50 PM evening check, streak is 0
  eve0: [
    () => `Evening check 🌙 Streak's at 0, so tonight's a fresh start. Any old homework?`,
    () => `Streak: 0. The bar is on the floor. Step over it: do the evening check.`,
    () => `Evening check. No streak to lose — the one upside of having no streak.`,
    () => `0 🔥. Tomorrow's study hall is your comeback. Tonight: answer the evening check.`,
    () => `Evening check time. Zero streak, zero excuses.`,
  ],
  // Sent once after 3 days of ignored reminders, then they pause until you open the app
  chill: `You've ignored me 3 days straight, so I'll stop texting. It's fine. I'm fine. Open the app when you miss me.`,
};
