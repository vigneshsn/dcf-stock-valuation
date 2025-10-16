import {Component} from "@angular/core";
import {MatButton} from "@angular/material/button";
import {RouterLink} from "@angular/router";

@Component({
    templateUrl: './feedback.html',
    imports: [
        MatButton,
        RouterLink
    ]
})
export class FeedbackComponent {

}