alter table contacts
  add column if not exists phone_lemlist text,
  add column if not exists phone_lusha   text;
