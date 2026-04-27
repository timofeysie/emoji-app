# Milestone 3 Smoke Tests

Milestone 3A evidence fields:

- gameId: 69eea6c33e577a4b8fd81cb7
- groupId: 69eea6f53d3a46c454c9cf58
- questionId: 69eea71b3d3a46c454c9cf5c
- guessId: 69eea73d3d3a46c454c9cf5f
- operator + timestamp

```sh
Windows PowerShell
Copyright (C) Microsoft Corporation. All rights reserved.

Install the latest PowerShell for new features and improvements! https://aka.ms/PSWindows

PS C:\Users\timof> cd repos
PS C:\Users\timof\repos> cd timo
PS C:\Users\timof\repos\timo> cd .\emoji-app\
PS C:\Users\timof\repos\timo\emoji-app> $base = "http://localhost:3000"
PS C:\Users\timof\repos\timo\emoji-app> $teacherUserId = "000000000000000000000001"
PS C:\Users\timof\repos\timo\emoji-app> $studentUserId = "000000000000000000000002"
PS C:\Users\timof\repos\timo\emoji-app> $badgeId = "000000000000000000000003"
PS C:\Users\timof\repos\timo\emoji-app> $createGameBody = @{
>>   title = "Milestone 2 Smoke Test Game"
>>   createdByUserId = $teacherUserId
>> } | ConvertTo-Json
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> $gameResponse = Invoke-RestMethod `
>>   -Method POST `
>>   -Uri "$base/api/games" `
>>   -ContentType "application/json" `
>>   -Body $createGameBody
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> $gameId = $gameResponse.gameId
PS C:\Users\timof\repos\timo\emoji-app> $gameId
69eea6c33e577a4b8fd81cb7
PS C:\Users\timof\repos\timo\emoji-app> $refereeBody = @{
>>   userId = $teacherUserId
>>   role = "referee"
>> } | ConvertTo-Json
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> Invoke-RestMethod `
>>   -Method POST `
>>   -Uri "$base/api/games/$gameId/participants" `
>>   -ContentType "application/json" `
>>   -Body $refereeBody

  ok
  --
True


PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> $playerBody = @{
>>   userId = $studentUserId
>>   role = "player"
>>   playMode = "standard"
>> } | ConvertTo-Json
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> Invoke-RestMethod `
>>   -Method POST `
>>   -Uri "$base/api/games/$gameId/participants" `
>>   -ContentType "application/json" `
>>   -Body $playerBody

  ok
  --
True


PS C:\Users\timof\repos\timo\emoji-app> $cardGroupBody = @{
>>   name = "Smoke Test Card Set"
>>   description = "A/B cards for manual test"
>>   cards = @(
>>     @{
>>       cardUid = "CARD-UID-A-001"
>>       slotLabel = "A"
>>       displayName = "Answer Card A"
>>     },
>>     @{
>>       cardUid = "CARD-UID-B-001"
>>       slotLabel = "B"
>>       displayName = "Answer Card B"
>>     }
>>   )
>> } | ConvertTo-Json -Depth 5
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> $groupResponse = Invoke-RestMethod `
>>   -Method POST `
>>   -Uri "$base/api/games/nfc-card-groups" `
>>   -ContentType "application/json" `
>>   -Body $cardGroupBody
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> $groupId = $groupResponse.groupId
PS C:\Users\timof\repos\timo\emoji-app> $groupId
69eea6f53d3a46c454c9cf58
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> $attachBody = @{
>>   assignedByUserId = $teacherUserId
>> } | ConvertTo-Json
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> Invoke-RestMethod `
>>   -Method POST `
>>   -Uri "$base/api/games/$gameId/nfc-card-groups/$groupId/attach" `
>>   -ContentType "application/json" `
>>   -Body $attachBody

  ok
  --
True


PS C:\Users\timof\repos\timo\emoji-app> $questionBody = @{
>>   gameId = $gameId
>>   createdByUserId = $teacherUserId
>>   text = "Which option is correct?"
>>   sequence = 1
>>   mode = "standard"
>>   answerOptions = @(
>>     @{
>>       text = "Option A"
>>       sequence = 1
>>       slotLabel = "A"
>>       isCorrect = $true
>>     },
>>     @{
>>       text = "Option B"
>>       sequence = 2
>>       slotLabel = "B"
>>       isCorrect = $false
>>     }
>>   )
>> } | ConvertTo-Json -Depth 6
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> $questionResponse = Invoke-RestMethod `
>>   -Method POST `
>>   -Uri "$base/api/questions" `
>>   -ContentType "application/json" `
>>   -Body $questionBody
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> $questionId = $questionResponse.questionId
PS C:\Users\timof\repos\timo\emoji-app> $questionId
69eea71b3d3a46c454c9cf5c
PS C:\Users\timof\repos\timo\emoji-app> $openQuestionBody = @{
>>   gameId = $gameId
>>   state = "open"
>> } | ConvertTo-Json
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> Invoke-RestMethod `
>>   -Method POST `
>>   -Uri "$base/api/questions/$questionId/state" `
>>   -ContentType "application/json" `
>>   -Body $openQuestionBody

  ok
  --
True


PS C:\Users\timof\repos\timo\emoji-app> $guessBody = @{
>>   gameId = $gameId
>>   questionId = $questionId
>>   guesserUserId = $studentUserId
>>   badgeId = $badgeId
>>   cardUid = "CARD-UID-A-001"
>> } | ConvertTo-Json
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> Invoke-RestMethod `
>>   -Method POST `
>>   -Uri "$base/api/guesses" `
>>   -ContentType "application/json" `
>>   -Body $guessBody

guessId                  answerOptionId
-------                  --------------
69eea73d3d3a46c454c9cf5f 69eea71b3d3a46c454c9cf5d


PS C:\Users\timof\repos\timo\emoji-app> $closeQuestionBody = @{
>>   gameId = $gameId
>>   state = "closed"
>> } | ConvertTo-Json
PS C:\Users\timof\repos\timo\emoji-app>
PS C:\Users\timof\repos\timo\emoji-app> Invoke-RestMethod `
>>   -Method POST `
>>   -Uri "$base/api/questions/$questionId/state" `
>>   -ContentType "application/json" `
>>   -Body $closeQuestionBody

  ok
  --
True
```
