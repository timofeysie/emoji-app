output "alb_arn" {
  description = "ARN of the application load balancer."
  value       = aws_lb.app.arn
}

output "alb_dns_name" {
  description = "Public DNS name of the ALB."
  value       = aws_lb.app.dns_name
}

output "alb_zone_id" {
  description = "Route 53 hosted zone id for the ALB (used by DNS aliases in T7)."
  value       = aws_lb.app.zone_id
}

output "target_group_arn" {
  description = "ARN of the ECS target group attached to this ALB."
  value       = aws_lb_target_group.tg.arn
}

output "http_listener_arn" {
  description = "ARN of the HTTP:80 listener."
  value       = aws_lb_listener.http.arn
}
