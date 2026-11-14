/// English and Bangladeshi Bangla for Ask. The app has no other languages.
class AskCopy {
  const AskCopy(this.bangla);

  final bool bangla;

  String pick(String en, String bn) => bangla ? bn : en;

  String get taskTitle => pick('New task', 'নতুন টাস্ক');
  String get leadTitle => pick('New lead', 'নতুন লিড');
  String get review => pick(
    'Check this before saving. Nothing is saved until you confirm.',
    'সেভ করার আগে দেখে নিন। আপনি নিশ্চিত না করা পর্যন্ত কিছু সেভ হয় না।',
  );
  String get title => pick('Title', 'শিরোনাম');
  String get description => pick('Description', 'বিবরণ');
  String get project => pick('Project', 'প্রজেক্ট');
  String get projectPlaceholder =>
      pick('Choose a project', 'একটি প্রজেক্ট বেছে নিন');
  String get noProjects =>
      pick('No project you can use.', 'আপনার ব্যবহারের মতো কোনো প্রজেক্ট নেই।');
  String get assignee => pick('Assignee', 'দায়িত্বপ্রাপ্ত');
  String get unassigned => pick('Unassigned', 'কাউকে দেওয়া হয়নি');
  String get chooseAssignee => pick('Choose a person', 'একজনকে বেছে নিন');
  String get dueDate => pick('Due date', 'শেষ তারিখ');
  String get clearDate => pick('Clear date', 'তারিখ মুছুন');
  String get priority => pick('Priority', 'অগ্রাধিকার');
  String get priorityLow => pick('Low', 'কম');
  String get priorityMedium => pick('Medium', 'মাঝারি');
  String get priorityHigh => pick('High', 'বেশি');
  String get priorityUrgent => pick('Urgent', 'জরুরি');
  String get name => pick('Name', 'নাম');
  String get phone => pick('Phone', 'ফোন');
  String get email => pick('Email', 'ইমেইল');
  String get emailInvalid => pick(
    "That email address doesn't look right.",
    'এই ইমেইল ঠিক মনে হচ্ছে না।',
  );
  String get note => pick('Note', 'নোট');
  String get owner => pick('Owner', 'মালিক');
  String get ownerYou => pick('You', 'আপনি');
  String get companyHint => pick(
    'A company name stays in the note. This does not create a company.',
    'কোম্পানির নাম নোটে থাকে। এতে কোনো কোম্পানি তৈরি হয় না।',
  );
  String get save => pick('Save', 'সেভ');
  String get saving => pick('Saving…', 'সেভ হচ্ছে…');
  String get cancel => pick('Cancel', 'বাতিল');
  String get savedTask => pick('Task saved.', 'টাস্ক সেভ হয়েছে।');
  String get savedLead => pick('Lead saved.', 'লিড সেভ হয়েছে।');
  String get openLead => pick('Open lead', 'লিড খুলুন');
  String get offline => pick(
    "You're offline. The draft stays here. Save is off until you're back — nothing is queued.",
    'আপনি অফলাইনে। খসড়া এখানেই থাকবে। অনলাইনে না আসা পর্যন্ত সেভ বন্ধ — কিছু জমা রাখা হয় না।',
  );

  String get betterBangla => pick('Better Bangla', 'ভালো বাংলা');
  String get betterBanglaHint => pick(
    "Sends the recording to Whisper when the phone's Bangla listener is weak. Uses AI credits: about 1 a minute, at least 0.05. Audio is sent only while this is on.",
    'ফোনের বাংলা শোনা দুর্বল হলে রেকর্ডিং Whisper-এ যায়। AI ক্রেডিট লাগে: প্রায় মিনিটে ১, কমপক্ষে ০.০৫। এটি চালু থাকলেই অডিও পাঠানো হয়।',
  );
  String get listening => pick('Listening…', 'শুনছি…');
  String get recording => pick('Recording…', 'রেকর্ড হচ্ছে…');
  String get transcribing => pick('Transcribing…', 'লেখা হচ্ছে…');
  String get speak => pick('Speak', 'বলুন');
  String get stopListening => pick('Stop listening', 'শোনা বন্ধ');
  String get stopRecording => pick('Stop recording', 'রেকর্ড বন্ধ');
  String get send => pick('Send', 'পাঠান');
  String get micUnavailable => pick(
    'This phone cannot listen right now. Check the microphone permission, or type the question.',
    'এই ফোন এখন শুনতে পারছে না। মাইক্রোফোনের অনুমতি দেখুন, অথবা প্রশ্নটি লিখুন।',
  );
  String get whisperNeedsNet => pick(
    "Better Bangla needs a connection. Turn it off to use the phone's listener, or type the question.",
    'ভালো বাংলার জন্য ইন্টারনেট লাগে। এটি বন্ধ করে ফোনের নিজের শোনা ব্যবহার করুন, অথবা লিখে পাঠান।',
  );
  String get whisperTooShort => pick(
    'That was too short. Hold the microphone and speak, then stop.',
    'খুব ছোট হয়ে গেছে। মাইক চেপে কথা বলুন, তারপর থামান।',
  );
  String get whisperFailed => pick(
    'Could not transcribe that. Try again, or type the question.',
    'লেখা হয়নি। আবার চেষ্টা করুন, অথবা লিখে পাঠান।',
  );

  String heard(num credits) {
    final shown = formatCredits(credits);
    return pick(
      'Heard. This used $shown credits. Check the words, then send.',
      'শোনা গেছে। এতে $shown ক্রেডিট লেগেছে। কথাগুলো দেখে তারপর পাঠান।',
    );
  }

  String creditsLine(num credits) {
    final shown = formatCredits(credits);
    if (bangla) return '$shown ক্রেডিট';
    return '$shown ${credits == 1 ? 'credit' : 'credits'}';
  }

  String get truncated => pick('Answer cut short', 'উত্তর কেটে গেছে');
  String get thinking =>
      pick('Looking through your records…', 'আপনার হিসাব দেখা হচ্ছে…');
  String get askPlaceholder =>
      pick('Ask about sales, stock, dues…', 'আপনার প্রশ্ন লিখুন');
  String get newConversation => pick('New conversation', 'নতুন কথোপকথন');
  String get emptyBody => pick(
    'Answers come from your own records, and only what your role can see. Each answer uses AI credits.',
    'উত্তর আপনার নিজের হিসাব থেকে আসে, আর শুধু সেটুকুই যা আপনার ভূমিকা দেখতে পারে। প্রতিটি উত্তরে AI ক্রেডিট লাগে।',
  );

  String priorityLabel(String code) => switch (code) {
    'LOW' => priorityLow,
    'HIGH' => priorityHigh,
    'URGENT' => priorityUrgent,
    _ => priorityMedium,
  };
}

/// 2 stays "2", 0.50 stays "0.5", 0.08 stays "0.08".
String formatCredits(num value) {
  if (value is int) return value.toString();
  final text = value.toStringAsFixed(2);
  if (text.endsWith('00')) return value.toStringAsFixed(0);
  if (text.endsWith('0')) return text.substring(0, text.length - 1);
  return text;
}
