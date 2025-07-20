> ⚠️ **Notice:** This is a work in progress. The goal is to turn this into an MCP server (Model Context Protocol).

# AR 3D Copy&Paste

Demo of the project showing its functionality: https://youtu.be/B52r1ccVacU	

This projects has three different interacting parts:
* iOS app: Uses ARKit to extract LiDAR’s information into an OBJ file and exports it with AirDrop.
* Local server written in Python and Flask: Gets picture from phone's camera and matches it with screenshot of computer, then creates coords.json and moves obj from "Downloads" to "Scans".
* Blender Script: Every second, it looks at "scans" folder for obj file. If there, it imports it on the scene at the (x, y) coordinates got from the json file. 

## How to run

Instructions on how to run the iOS [app][1] and the local [server][2] are at each respective folders. 
Also, add the Blender [script][3] into your Blender scene and auto-run it on start-up.


[1]:app
[2]:server
[3]:scripts/importObject.py

