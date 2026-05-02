output "vpc_id" {
  description = "ID of the default VPC used by this environment."
  value       = data.aws_vpc.default.id
}

output "subnet_ids" {
  description = "All subnet IDs in the default VPC, suitable for ALB and ECS service placement."
  value       = data.aws_subnets.default.ids
}

output "alb_security_group_id" {
  description = "Security group ID for the ALB (emoji-staging-alb-sg)."
  value       = aws_security_group.alb.id
}

output "ecs_security_group_id" {
  description = "Security group ID for the ECS tasks (emoji-staging-ecs-sg)."
  value       = aws_security_group.ecs.id
}
