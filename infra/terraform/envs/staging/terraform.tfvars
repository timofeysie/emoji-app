aws_region  = "ap-southeast-2"
environment = "staging"

# Pinned to the immutable tag created in pre-T0. CI in T8 will switch
# to digest pinning.
image_uri = "100641718971.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app:staging-2026-05-03"

# Flipped to true after creating emoji-app/staging/openai-api-key in
# Secrets Manager (see pre-T0 gap #1, resolved before T5).
openai_secret_enabled = true

# Cognito values mirror task definition revision 1, which was registered
# manually before T5. Centralising them in tfvars means a future Cognito
# rotation is a one-line change here, not a console click.
cognito_region        = "ap-southeast-2"
cognito_user_pool_id  = "ap-southeast-2_Myj579Wg2"
cognito_app_client_id = "7d0kjtsi0h8kjhk2fg1ee64h55"
