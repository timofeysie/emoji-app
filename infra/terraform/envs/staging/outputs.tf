output "vpc_id" {
  description = "Default VPC used by staging."
  value       = module.network.vpc_id
}

output "subnet_ids" {
  description = "Subnet IDs in the default VPC."
  value       = module.network.subnet_ids
}

output "alb_security_group_id" {
  description = "Security group attached to the ALB."
  value       = module.network.alb_security_group_id
}

output "ecs_security_group_id" {
  description = "Security group attached to the ECS tasks."
  value       = module.network.ecs_security_group_id
}

output "alb_arn" {
  description = "ARN of the application load balancer."
  value       = module.alb.alb_arn
}

output "alb_dns_name" {
  description = "Public DNS name of the ALB (use this to hit the staging app over HTTP)."
  value       = module.alb.alb_dns_name
}

output "target_group_arn" {
  description = "ARN of the ECS target group attached to the ALB."
  value       = module.alb.target_group_arn
}

output "http_listener_arn" {
  description = "ARN of the HTTP:80 listener."
  value       = module.alb.http_listener_arn
}

output "https_listener_arn" {
  description = "ARN of the HTTPS:443 listener."
  value       = module.alb.https_listener_arn
}

output "staging_app_url" {
  description = "Public HTTPS URL for the staging host (after DNS and TLS propagate)."
  value       = module.alb.app_url_https
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN (DNS-validated)."
  value       = module.acm.certificate_arn
}

output "ecs_execution_role_arn" {
  description = "ARN of the ECS task execution role."
  value       = module.iam_ecs.execution_role_arn
}

output "ecs_task_role_arn" {
  description = "ARN of the ECS task role."
  value       = module.iam_ecs.task_role_arn
}

output "task_definition_arn" {
  description = "ARN (with revision) of the latest Terraform-managed task definition."
  value       = module.ecs_service.task_definition_arn
}

output "task_definition_family" {
  description = "Task definition family name."
  value       = module.ecs_service.task_definition_family
}

output "task_definition_revision" {
  description = "Numeric revision Terraform last registered."
  value       = module.ecs_service.task_definition_revision
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = module.ecs_service.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = module.ecs_service.service_name
}

output "ecs_log_group_name" {
  description = "CloudWatch log group the application writes to."
  value       = module.ecs_service.log_group_name
}
