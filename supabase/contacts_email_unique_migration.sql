create unique index if not exists contacts_email_client_unique
  on contacts (email, client_id)
  where email is not null;
